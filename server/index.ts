import 'dotenv/config'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import cors from 'cors'
import express from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { dbEnabled, pool } from './db'
import { overviewData as demoOverview } from '../src/data/mock'
import type { Company, EventItem, OverviewData } from '../src/types'

const app = express()
const port = Number(process.env.APP_PORT ?? 3002)
app.use(cors())
app.use(express.json())

type IngestionStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed'
type IngestionState = {
  status: IngestionStatus
  runId?: number
  taskName: string
  startedAt?: string
  finishedAt?: string
  recordsWritten: number
  warningCount: number
  message?: string
  output: string[]
}

type SyncTaskKey = 'quotes' | 'industry' | 'concepts' | 'boards'
type SyncTaskDefinition = {
  key: SyncTaskKey
  label: string
  description: string
  cadence: string
  command: string
  args: string[]
  retryable: boolean
}
type SyncRuntime = {
  process: ChildProcessWithoutNullStreams
  syncRunId: number
  output: string[]
  warnings: number
  recordsWritten: number
}

const syncTaskDefinitions: Record<SyncTaskKey, SyncTaskDefinition> = {
  quotes: { key: 'quotes', label: '行情与估值', description: '逐公司补齐最新交易日的日线、市场估值与换手率。', cadence: '每日盘后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-akshare.py'], retryable: true },
  industry: { key: 'industry', label: '行业归属', description: '仅补齐缺失行业；AKShare 优先，公开页面为兼容回退。', cadence: '按需 / 低频', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-company-industry.py'], retryable: false },
  concepts: { key: 'concepts', label: '概念归属', description: '概念板块成分反向匹配公司池，支持断点续跑。', cadence: '每周或按需', command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', 'scripts/ingest-company-concepts.py'], retryable: false },
  boards: { key: 'boards', label: '板块聚合', description: '基于已入库最新行情计算公司池与行业板块表现。', cadence: '行情更新后', command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', 'scripts/aggregate-boards.ts'], retryable: false },
}

const activeSyncTasks = new Map<SyncTaskKey, SyncRuntime>()
const retryAttempts = new Map<SyncTaskKey, number>()

let ingestionProcess: ChildProcessWithoutNullStreams | null = null
let ingestionState: IngestionState = { status: 'idle', taskName: 'akshare_daily_quote', recordsWritten: 0, warningCount: 0, output: [] }

const isoOrNull = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined

async function latestIngestionState(): Promise<IngestionState> {
  if (!pool) return ingestionState
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT id, task_name, status, started_at, finished_at, records_written, error_message
    FROM aero_ingestion_run
    WHERE task_name = 'akshare_daily_quote'
    ORDER BY id DESC LIMIT 1
  `)
  const row = rows[0]
  if (!row) return ingestionState
  return {
    status: row.status as IngestionStatus,
    runId: Number(row.id),
    taskName: String(row.task_name),
    startedAt: isoOrNull(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
    recordsWritten: Number(row.records_written ?? 0),
    warningCount: row.error_message ? String(row.error_message).split('\n').filter(Boolean).length : 0,
    message: row.error_message ? String(row.error_message) : undefined,
    output: ingestionState.runId === Number(row.id) ? ingestionState.output : [],
  }
}

function startQuoteIngestion() {
  if (ingestionProcess) return false
  const python = `${process.cwd()}/.venv313/bin/python`
  ingestionState = { status: 'running', taskName: 'akshare_daily_quote', startedAt: new Date().toISOString(), recordsWritten: 0, warningCount: 0, output: [] }
  ingestionProcess = spawn(python, ['scripts/ingest-akshare.py'], { cwd: process.cwd(), env: process.env })
  const appendOutput = (chunk: Buffer) => {
    ingestionState.output = [...ingestionState.output, ...chunk.toString().split(/\r?\n/).filter(Boolean)].slice(-20)
  }
  createInterface({ input: ingestionProcess.stdout }).on('line', (line) => appendOutput(Buffer.from(line)))
  createInterface({ input: ingestionProcess.stderr }).on('line', (line) => appendOutput(Buffer.from(line)))
  ingestionProcess.on('close', (code) => {
    ingestionProcess = null
    ingestionState = { ...ingestionState, status: code === 0 ? 'success' : 'failed', finishedAt: new Date().toISOString(), message: code === 0 ? '行情采集完成。' : `采集进程退出，代码 ${code ?? '未知'}。` }
  })
  ingestionProcess.on('error', (error) => {
    ingestionProcess = null
    ingestionState = { ...ingestionState, status: 'failed', finishedAt: new Date().toISOString(), message: error.message }
  })
  return true
}

function parseSyncProgress(line: string) {
  const completed = line.match(/完成：(?:写入 )?(\d+) 条，(\d+) 个告警/)
  if (completed) return { recordsWritten: Number(completed[1]), warnings: Number(completed[2]) }
  const board = line.match(/已写入 (\d+) 条公司池板块数据/)
  if (board) return { recordsWritten: Number(board[1]), warnings: 0 }
  return null
}

async function appendSyncLog(syncRunId: number, logLevel: 'info' | 'warn' | 'error', message: string) {
  if (!pool) return
  await pool.execute('INSERT INTO aero_sync_log (sync_run_id, log_level, message) VALUES (?, ?, ?)', [syncRunId, logLevel, message.slice(0, 8000)])
}

async function startSyncTask(taskKey: SyncTaskKey, retryAttempt = 0): Promise<{ started: boolean; message?: string }> {
  if (!pool) return { started: false, message: '数据库连接未初始化。' }
  if (activeSyncTasks.has(taskKey)) return { started: false, message: '该任务正在运行。' }
  if (activeSyncTasks.size) return { started: false, message: '已有其他同步任务运行，为避免上游限流，请等待其结束。' }
  const task = syncTaskDefinitions[taskKey]
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO aero_sync_run (task_key, task_label, status, started_at) VALUES (?, ?, \'running\', CURRENT_TIMESTAMP)',
    [task.key, task.label],
  )
  const syncRunId = Number(result.insertId)
  const child = spawn(task.command, task.args, { cwd: process.cwd(), env: process.env })
  const runtime: SyncRuntime = { process: child, syncRunId, output: [], warnings: 0, recordsWritten: 0 }
  activeSyncTasks.set(taskKey, runtime)
  await appendSyncLog(syncRunId, 'info', `任务已启动：${task.label}（第 ${retryAttempt + 1} 次尝试）`)

  const append = (line: string, level: 'info' | 'warn' | 'error') => {
    if (!line.trim()) return
    runtime.output = [...runtime.output, line].slice(-120)
    if (level !== 'info') runtime.warnings += 1
    const progress = parseSyncProgress(line)
    if (progress) { runtime.recordsWritten = progress.recordsWritten; runtime.warnings = Math.max(runtime.warnings, progress.warnings) }
    void appendSyncLog(syncRunId, level, line).catch(() => undefined)
  }
  createInterface({ input: child.stdout }).on('line', (line) => append(line, 'info'))
  createInterface({ input: child.stderr }).on('line', (line) => append(line, 'error'))
  child.on('error', (error) => append(error.message, 'error'))
  child.on('close', async (code) => {
    activeSyncTasks.delete(taskKey)
    const failed = code !== 0
    const shouldRetry = failed && task.retryable && retryAttempt < 2
    const delayMs = 15 * 60 * 1000 * (retryAttempt + 1)
    const retryAt = shouldRetry ? new Date(Date.now() + delayMs) : null
    const status: IngestionStatus = failed ? 'failed' : runtime.warnings ? 'partial' : 'success'
    const lastError = runtime.output.filter((line) => /失败|错误|error/i.test(line)).slice(-1)[0] ?? null
    try {
      if (!pool) return
      await pool.execute(
        'UPDATE aero_sync_run SET status=?, finished_at=CURRENT_TIMESTAMP, records_written=?, warning_count=?, retry_at=?, error_message=? WHERE id=?',
        [status, runtime.recordsWritten, runtime.warnings, retryAt, lastError, syncRunId],
      )
      await appendSyncLog(syncRunId, failed ? 'error' : runtime.warnings ? 'warn' : 'info', failed ? `任务退出，代码 ${code ?? '未知'}。` : '任务已结束。')
    } catch {
      // 进程结束后的记录失败不再影响子进程生命周期。
    }
    if (shouldRetry) {
      retryAttempts.set(taskKey, retryAttempt + 1)
      setTimeout(() => { void startSyncTask(taskKey, retryAttempt + 1) }, delayMs)
    } else {
      retryAttempts.delete(taskKey)
    }
  })
  return { started: true }
}

async function syncTaskViews() {
  if (!pool) return Object.values(syncTaskDefinitions).map((task) => ({ ...task, status: 'idle', recordsWritten: 0, warningCount: 0, running: false }))
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT r.* FROM aero_sync_run r
    INNER JOIN (SELECT task_key, MAX(id) AS id FROM aero_sync_run GROUP BY task_key) latest ON latest.id = r.id
  `)
  const latestByKey = new Map(rows.map((row) => [String(row.task_key), row]))
  return Object.values(syncTaskDefinitions).map((task) => {
    const row = latestByKey.get(task.key)
    const runtime = activeSyncTasks.get(task.key)
    return {
      key: task.key, label: task.label, description: task.description, cadence: task.cadence,
      status: runtime ? 'running' : row?.status ?? 'idle', running: Boolean(runtime), syncRunId: runtime?.syncRunId ?? (row ? Number(row.id) : undefined),
      startedAt: runtime ? undefined : isoOrNull(row?.started_at), finishedAt: runtime ? undefined : isoOrNull(row?.finished_at),
      recordsWritten: runtime?.recordsWritten ?? Number(row?.records_written ?? 0), warningCount: runtime?.warnings ?? Number(row?.warning_count ?? 0),
      retryAt: isoOrNull(row?.retry_at), errorMessage: row?.error_message ? String(row.error_message) : undefined,
      retryEnabled: task.retryable, retryAttempt: retryAttempts.get(task.key) ?? 0,
    }
  })
}

type CompanyRow = RowDataPacket & {
  stock_code: string
  company_name: string
  related_level: string
  industry: string | null
  concept: string | null
  close_price: number | null
  change_pct: number | null
  market_cap: number | null
  prices: string | null
}

type EventRow = RowDataPacket & {
  id: number
  announced_at: Date | string
  company_name: string | null
  stock_code: string | null
  event_type: string
  title: string
  detail: string | null
  risk_level: '高' | '中' | '低'
  status: string | null
}

const decimal = (value: number | null, digits = 2) => value === null ? '--' : Number(value).toFixed(digits)
const marketCap = (value: number | null) => value === null ? '--' : `${(Number(value) / 100_000_000).toFixed(1)} 亿`
const dateTime = (value: Date | string) => new Date(value).toLocaleString('zh-CN', { hour12: false }).replaceAll('/', '-')
const time = (value: Date | string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

function signalFor(change: number, hasRisk: boolean): Pick<Company, 'signal' | 'signalTone'> {
  if (hasRisk) return { signal: '风险事件', signalTone: 'negative' }
  if (change >= 3) return { signal: '相对强势', signalTone: 'positive' }
  if (change <= -3) return { signal: '弱势回撤', signalTone: 'negative' }
  return { signal: '等待数据', signalTone: 'neutral' }
}

async function getDatabaseOverview(): Promise<OverviewData> {
  if (!pool) throw new Error('数据库未启用')
  const [companyRows] = await pool.query<CompanyRow[]>(`
    SELECT c.stock_code, c.company_name, c.related_level,
      MAX(CASE WHEN t.tag_type = '行业' THEN t.tag_name END) AS industry,
      MAX(CASE WHEN t.tag_type = '概念' THEN t.tag_name END) AS concept,
      q.close_price, q.change_pct, q.market_cap,
      (SELECT GROUP_CONCAT(close_price ORDER BY trade_date ASC SEPARATOR ',')
       FROM (SELECT close_price, trade_date FROM aero_daily_quote WHERE company_id = c.id ORDER BY trade_date DESC LIMIT 8) recent_quotes) AS prices
    FROM aero_company c
    LEFT JOIN aero_daily_quote q ON q.company_id = c.id
      AND q.trade_date = (SELECT MAX(q2.trade_date) FROM aero_daily_quote q2 WHERE q2.company_id = c.id)
    LEFT JOIN aero_company_tag t ON t.company_id = c.id AND (t.effective_to IS NULL OR t.effective_to >= CURDATE())
    WHERE c.is_active = 1
    GROUP BY c.id, c.stock_code, c.company_name, c.related_level, q.close_price, q.change_pct, q.market_cap
    ORDER BY c.related_level, c.stock_code
  `)
  const [eventRows] = await pool.query<EventRow[]>(`
    SELECT e.id, e.announced_at, c.company_name, c.stock_code, e.event_type, e.title, e.detail, e.risk_level, e.status
    FROM aero_event e LEFT JOIN aero_company c ON c.id = e.company_id
    ORDER BY e.announced_at DESC LIMIT 100
  `)
  const riskCodes = new Set(eventRows.filter((event) => event.risk_level === '高').map((event) => event.stock_code))
  const companies: Company[] = companyRows.map((row) => {
    const change = row.change_pct === null ? 0 : Number(row.change_pct)
    const signal = signalFor(change, Boolean(row.stock_code && riskCodes.has(row.stock_code)))
    const spark = row.prices?.split(',').map(Number).filter(Number.isFinite) ?? []
    return {
      code: row.stock_code, name: row.company_name, level: row.related_level, industry: row.industry ?? '待补充', concept: row.concept ?? '待补充',
      price: decimal(row.close_price), change, marketCap: marketCap(row.market_cap), tags: [], spark: spark.length ? spark : [0], ...signal,
    }
  })
  const events: EventItem[] = eventRows.map((row) => ({
    id: `evt-${row.id}`, time: time(row.announced_at), company: row.company_name ?? '市场事件', code: row.stock_code ?? '--', type: row.event_type,
    title: row.title, detail: row.detail ?? '暂无事件摘要。', level: row.risk_level, ...(row.status ? { status: row.status } : {}),
  }))
  const [boardRows] = await pool.query<RowDataPacket[]>(`
    SELECT board_name, change_pct, rising_count, falling_count, leader_name
    FROM aero_board_quote WHERE trade_date = (SELECT MAX(trade_date) FROM aero_board_quote)
    ORDER BY change_pct DESC LIMIT 8
  `)
  const [macroRows] = await pool.query<RowDataPacket[]>(`
    SELECT indicator_name, value, value_text, change_pct, unit
    FROM aero_macro_indicator WHERE observed_date = (SELECT MAX(observed_date) FROM aero_macro_indicator)
    ORDER BY indicator_name LIMIT 8
  `)
  const latestQuote = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS trade_date FROM aero_daily_quote")
  const asOf = latestQuote[0][0]?.trade_date ? `${latestQuote[0][0].trade_date} 盘后` : '尚未导入行情数据'
  const positive = companies.filter((company) => company.change > 0).length
  return {
    asOf,
    coverage: `${companies.length} 家航天相关 A 股`,
    companies,
    events,
    boards: boardRows.map((row) => ({ name: row.board_name, change: Number(row.change_pct ?? 0), breadth: `${row.rising_count ?? 0} / ${(row.rising_count ?? 0) + (row.falling_count ?? 0)}`, leader: row.leader_name ?? '待补充' })),
    macro: macroRows.map((row) => ({ label: row.indicator_name, value: row.value_text ?? `${decimal(row.value, 4)}${row.unit ?? ''}`, change: row.change_pct === null ? '暂无环比' : `${Number(row.change_pct) >= 0 ? '+' : ''}${decimal(row.change_pct)}%`, tone: row.change_pct === null ? 'flat' : Number(row.change_pct) >= 0 ? 'up' : 'down' })),
    observations: [
      { index: '01', title: '数据覆盖', body: `已纳入 ${companies.length} 家公司；其中 ${positive} 家最新行情上涨。`, tone: 'cyan' },
      { index: '02', title: '高风险事件', body: `当前有 ${eventRows.filter((event) => event.risk_level === '高').length} 条高风险事项，需要结合原公告复核。`, tone: 'red' },
      { index: '03', title: '待补数据', body: '缺失的行情、板块或宏观数据会明确显示为空，不以演示值替代。', tone: 'amber' },
    ],
  }
}

async function overview() {
  if (!dbEnabled) return { ...demoOverview, dataMode: 'demo' as const }
  return { ...(await getDatabaseOverview()), dataMode: 'mysql' as const }
}

app.get('/api/health', async (_req, res) => {
  let database = 'disabled'
  if (dbEnabled && pool) {
    try { await pool.query('SELECT 1'); database = 'connected' } catch { database = 'unavailable' }
  }
  res.json({ ok: true, database, mode: dbEnabled ? 'mysql' : 'demo' })
})

app.get('/api/ingestion/status', async (_req, res) => {
  try {
    res.json(await latestIngestionState())
  } catch (error) {
    res.status(503).json({ error: '无法读取采集状态', detail: error instanceof Error ? error.message : '未知错误' })
  }
})

app.post('/api/ingestion/quotes', (_req, res) => {
  if (!dbEnabled) return res.status(400).json({ error: '当前为演示模式，请先在 .env 中设置 DB_ENABLED=true。' })
  if (!pool) return res.status(503).json({ error: '数据库连接未初始化。' })
  if (!startQuoteIngestion()) return res.status(409).json({ error: '行情采集正在进行中，请稍后查看状态。' })
  return res.status(202).json({ status: 'running', message: '行情采集已启动。' })
})

app.get('/api/sync/tasks', async (_req, res) => {
  try {
    res.json({ items: await syncTaskViews(), refreshedAt: new Date().toISOString() })
  } catch (error) {
    res.status(503).json({ error: '无法读取同步任务', detail: error instanceof Error ? error.message : '未知错误' })
  }
})

app.get('/api/sync/tasks/:taskKey/logs', async (req, res) => {
    const taskKey = String(req.params.taskKey ?? '') as SyncTaskKey
  if (!(taskKey in syncTaskDefinitions)) return res.status(404).json({ error: '未知同步任务。' })
  if (!pool) return res.json({ items: [], runId: null })
  try {
    const runtime = activeSyncTasks.get(taskKey)
    let latestRunId = runtime?.syncRunId ?? null
    if (!latestRunId) {
      const [runRows] = await pool.query<RowDataPacket[]>('SELECT id FROM aero_sync_run WHERE task_key=? ORDER BY id DESC LIMIT 1', [taskKey])
      latestRunId = runRows[0] ? Number(runRows[0].id) : null
    }
    if (!latestRunId) return res.json({ items: [], runId: null })
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, log_level, message, created_at FROM aero_sync_log WHERE sync_run_id=? ORDER BY id DESC LIMIT 160', [latestRunId],
    )
    const items = rows.reverse().map((row) => ({ id: Number(row.id), level: row.log_level, message: row.message, createdAt: isoOrNull(row.created_at) }))
    res.json({ items, runId: latestRunId })
  } catch (error) {
    res.status(503).json({ error: '无法读取任务日志', detail: error instanceof Error ? error.message : '未知错误' })
  }
})

app.post('/api/sync/tasks/:taskKey/run', async (req, res) => {
  const taskKey = String(req.params.taskKey ?? '') as SyncTaskKey
  if (!(taskKey in syncTaskDefinitions)) return res.status(404).json({ error: '未知同步任务。' })
  if (!dbEnabled) return res.status(400).json({ error: '当前为演示模式，请先在 .env 中设置 DB_ENABLED=true。' })
  try {
    const result = await startSyncTask(taskKey)
    if (!result.started) return res.status(409).json({ error: result.message })
    return res.status(202).json({ status: 'running', message: `${syncTaskDefinitions[taskKey].label}已启动。` })
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : '同步任务启动失败。' })
  }
})

app.get('/api/overview', async (_req, res) => {
  try { res.json(await overview()) } catch (error) { res.status(503).json({ error: '数据库查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})
app.get('/api/companies', async (_req, res) => {
  try { const data = await overview(); res.json({ items: data.companies, dataMode: data.dataMode }) } catch (error) { res.status(503).json({ error: '数据库查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})
app.get('/api/companies/:code', async (req, res) => {
  const code = String(req.params.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '股票代码格式不正确。' })
  if (!dbEnabled || !pool) return res.status(400).json({ error: '公司详情仅在 MySQL 数据模式下可用。' })
  try {
    const [companyRows] = await pool.query<RowDataPacket[]>(`
      SELECT c.id, c.stock_code, c.company_name, c.exchange, c.related_level, c.description,
        DATE_FORMAT(q.trade_date, '%Y-%m-%d') AS trade_date, q.open_price, q.high_price, q.low_price, q.close_price, q.change_pct,
        q.volume, q.turnover, q.turnover_rate, q.market_cap, q.pe_ttm, q.pb, q.source_name
      FROM aero_company c
      LEFT JOIN aero_daily_quote q ON q.company_id = c.id
        AND q.trade_date = (SELECT MAX(q2.trade_date) FROM aero_daily_quote q2 WHERE q2.company_id = c.id)
      WHERE c.stock_code = ? AND c.is_active = 1
      LIMIT 1
    `, [code])
    const company = companyRows[0]
    if (!company) return res.status(404).json({ error: '未找到该公司。' })
    const [tagRows, quoteRows, eventRows, factRows] = await Promise.all([
      pool.query<RowDataPacket[]>('SELECT tag_type, tag_name FROM aero_company_tag WHERE company_id = ? AND (effective_to IS NULL OR effective_to >= CURDATE()) ORDER BY tag_type, tag_name', [company.id]),
      pool.query<RowDataPacket[]>('SELECT DATE_FORMAT(trade_date, \'%Y-%m-%d\') AS trade_date, open_price, high_price, low_price, close_price, change_pct, volume, turnover, turnover_rate FROM aero_daily_quote WHERE company_id = ? ORDER BY trade_date DESC LIMIT 20', [company.id]),
      pool.query<RowDataPacket[]>('SELECT id, event_type, status, risk_level, title, detail, DATE_FORMAT(announced_at, \'%Y-%m-%d %H:%i\') AS announced_at FROM aero_event WHERE company_id = ? ORDER BY announced_at DESC LIMIT 8', [company.id]),
      pool.query<RowDataPacket[]>('SELECT fact_type, title, content, fact_state, DATE_FORMAT(disclosed_at, \'%Y-%m-%d\') AS disclosed_at, source_name, source_url FROM aero_business_fact WHERE company_id = ? ORDER BY disclosed_at DESC, id DESC LIMIT 8', [company.id]),
    ])
    res.json({
      company: {
        code: company.stock_code, name: company.company_name, exchange: company.exchange, level: company.related_level, description: company.description,
        latestQuote: company.trade_date ? {
          tradeDate: company.trade_date, open: decimal(company.open_price), high: decimal(company.high_price), low: decimal(company.low_price), close: decimal(company.close_price),
          change: company.change_pct === null ? null : Number(company.change_pct), volume: company.volume === null ? null : Number(company.volume), turnover: company.turnover === null ? null : Number(company.turnover), turnoverRate: company.turnover_rate === null ? null : Number(company.turnover_rate), marketCap: marketCap(company.market_cap), peTtm: decimal(company.pe_ttm), pb: decimal(company.pb), source: company.source_name,
        } : null,
      },
      tags: tagRows[0].map((row) => ({ type: row.tag_type, name: row.tag_name })),
      quotes: quoteRows[0].map((row) => ({ date: row.trade_date, open: Number(row.open_price), high: Number(row.high_price), low: Number(row.low_price), close: Number(row.close_price), change: row.change_pct === null ? null : Number(row.change_pct), volume: row.volume === null ? null : Number(row.volume), turnover: row.turnover === null ? null : Number(row.turnover), turnoverRate: row.turnover_rate === null ? null : Number(row.turnover_rate) })),
      events: eventRows[0].map((row) => ({ id: row.id, type: row.event_type, status: row.status, level: row.risk_level, title: row.title, detail: row.detail, announcedAt: row.announced_at })),
      facts: factRows[0].map((row) => ({ type: row.fact_type, title: row.title, content: row.content, state: row.fact_state, disclosedAt: row.disclosed_at, source: row.source_name, sourceUrl: row.source_url })),
    })
  } catch (error) { res.status(503).json({ error: '公司详情查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})
app.get('/api/events', async (_req, res) => {
  try { const data = await overview(); res.json({ items: data.events, dataMode: data.dataMode }) } catch (error) { res.status(503).json({ error: '数据库查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.listen(port, () => console.log(`Aero API listening on http://localhost:${port} (${dbEnabled ? 'mysql' : 'demo'} mode)`))
