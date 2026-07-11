import 'dotenv/config'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import cors from 'cors'
import express from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { dbEnabled, pool } from './db'
import { demoProfiles, overviewData as demoOverview } from '../src/data/mock'
import type { Company, CompanySpaceProfile, DataState, EventItem, OverviewData } from '../src/types'

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

type SyncTaskKey = 'quotes' | 'announcements' | 'events' | 'industry' | 'concepts' | 'finance' | 'boards' | 'macro' | 'report'
type SyncTaskDefinition = {
  key: SyncTaskKey
  label: string
  description: string
  cadence: string
  command: string
  args: string[]
  retryable: boolean
  ingestionTaskName?: string
}
type SyncRuntime = {
  process: ChildProcessWithoutNullStreams
  syncRunId: number
  output: string[]
  warnings: number
  recordsWritten: number
  resolve: (result: SyncTaskCompletion) => void
}
type SyncTaskCompletion = { status: IngestionStatus; code: number | null }
type DailySyncTrigger = 'scheduled' | 'manual'
type DailySyncRuntime = {
  pipelineRunId: number
  trigger: DailySyncTrigger
  startedAt: string
  currentTask?: SyncTaskKey
  retryAt?: string
}

const syncTaskDefinitions: Record<SyncTaskKey, SyncTaskDefinition> = {
  quotes: { key: 'quotes', label: '行情与估值', description: '逐公司补齐最新交易日的日线、市场估值与换手率。', cadence: '每日盘后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-akshare.py'], retryable: true, ingestionTaskName: 'akshare_daily_quote' },
  announcements: { key: 'announcements', label: '公告采集', description: '东财个股公告为主源，巨潮资讯为非科创板回退，按来源和外部键去重。', cadence: '每日盘后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-announcements.py'], retryable: true, ingestionTaskName: 'cninfo_announcement' },
  events: { key: 'events', label: '事件抽取', description: '从公告标题规则分类重大事项，解析减持字段并维护状态机。', cadence: '公告更新后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/extract-events.py'], retryable: false, ingestionTaskName: 'rule_event_extraction' },
  industry: { key: 'industry', label: '行业归属', description: '仅补齐缺失行业；BaoStock 优先，东方财富为兼容回退。', cadence: '按需 / 低频', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-company-industry.py'], retryable: false, ingestionTaskName: 'eastmoney_company_industry' },
  concepts: { key: 'concepts', label: '概念归属', description: '概念板块成分反向匹配公司池，支持断点续跑。', cadence: '每周或按需', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-company-concepts.py'], retryable: false, ingestionTaskName: 'akshare_company_concept' },
  finance: { key: 'finance', label: '季频财务', description: '归档 BaoStock 盈利能力原始字段，默认回补最近 8 个报告期。', cadence: '季报披露后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-baostock-finance.py'], retryable: false, ingestionTaskName: 'baostock_financial_profit' },
  boards: { key: 'boards', label: '板块聚合', description: '基于已入库最新行情计算公司池与行业板块表现。', cadence: '行情更新后', command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', 'scripts/aggregate-boards.ts'], retryable: false },
  macro: { key: 'macro', label: '宏观指标', description: '采集 A 股指数、全球指数、汇率和回购利率等宏观指标。', cadence: '每日盘后', command: `${process.cwd()}/.venv313/bin/python`, args: ['scripts/ingest-macro.py'], retryable: false, ingestionTaskName: 'macro_indicator' },
  report: { key: 'report', label: '日报生成', description: '汇总行情、板块、事件和宏观，生成盘后 Markdown 简报并归档。', cadence: '盘后流程末尾', command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', 'scripts/generate-report.ts'], retryable: false },
}

const activeSyncTasks = new Map<SyncTaskKey, SyncRuntime>()
const retryAttempts = new Map<SyncTaskKey, number>()
let activeDailySync: DailySyncRuntime | null = null

const DAILY_SYNC_ENABLED = process.env.DAILY_SYNC_ENABLED !== 'false'
const DAILY_SYNC_TIME = /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.DAILY_SYNC_TIME ?? '') ? String(process.env.DAILY_SYNC_TIME) : '18:30'
const DAILY_SYNC_TIME_ZONE = process.env.DAILY_SYNC_TIME_ZONE ?? 'Asia/Shanghai'
const DAILY_SYNC_TASKS: SyncTaskKey[] = ['quotes', 'announcements', 'events', 'boards', 'macro', 'report']

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
  if (ingestionProcess || activeSyncTasks.size || activeDailySync) return false
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

async function startSyncTask(taskKey: SyncTaskKey, retryAttempt = 0, autoRetry = true, fromDailySync = false): Promise<{ started: boolean; message?: string; completion?: Promise<SyncTaskCompletion> }> {
  if (!pool) return { started: false, message: '数据库连接未初始化。' }
  if (activeSyncTasks.has(taskKey)) return { started: false, message: '该任务正在运行。' }
  if (activeDailySync && !fromDailySync) return { started: false, message: '盘后同步流程正在执行，请等待当前批次结束。' }
  if (activeSyncTasks.size || ingestionProcess) return { started: false, message: '已有其他同步任务运行，为避免上游限流，请等待其结束。' }
  const task = syncTaskDefinitions[taskKey]
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO aero_sync_run (task_key, task_label, status, started_at) VALUES (?, ?, \'running\', CURRENT_TIMESTAMP)',
    [task.key, task.label],
  )
  const syncRunId = Number(result.insertId)
  const child = spawn(task.command, task.args, { cwd: process.cwd(), env: process.env })
  let resolveCompletion: (result: SyncTaskCompletion) => void = () => undefined
  const completion = new Promise<SyncTaskCompletion>((resolve) => { resolveCompletion = resolve })
  const runtime: SyncRuntime = { process: child, syncRunId, output: [], warnings: 0, recordsWritten: 0, resolve: resolveCompletion }
  activeSyncTasks.set(taskKey, runtime)
  await appendSyncLog(syncRunId, 'info', `任务已启动：${task.label}（第 ${retryAttempt + 1} 次尝试）`)

  const append = (line: string, level: 'info' | 'warn' | 'error') => {
    if (!line.trim()) return
    if (line.includes("The 'NO_COLOR' env is ignored") || line.includes('Use `node --trace-warnings')) return
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
    const shouldRetry = failed && autoRetry && task.retryable && retryAttempt < 2
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
      setTimeout(() => { void startSyncTask(taskKey, retryAttempt + 1, true) }, delayMs)
    } else {
      retryAttempts.delete(taskKey)
    }
    runtime.resolve({ status, code: code ?? null })
  })
  return { started: true, completion }
}

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_SYNC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

function isWeekday(isoDate: string) {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function updateDailySyncRun(runtime: DailySyncRuntime, fields: { status?: IngestionStatus; currentTask?: SyncTaskKey | null; retryAt?: Date | null; finished?: boolean; errorMessage?: string | null }) {
  if (!pool) return
  await pool.execute(
    `UPDATE aero_sync_pipeline_run
     SET status=COALESCE(?, status), current_task=?, retry_at=?, finished_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE finished_at END, error_message=?
     WHERE id=?`,
    [fields.status ?? null, fields.currentTask ?? null, fields.retryAt ?? null, Boolean(fields.finished), fields.errorMessage ?? null, runtime.pipelineRunId],
  )
}

async function runDailyTask(runtime: DailySyncRuntime, taskKey: SyncTaskKey) {
  const task = syncTaskDefinitions[taskKey]
  const attempts = task.retryable ? 3 : 1
  let lastResult: SyncTaskCompletion = { status: 'failed', code: null }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    runtime.currentTask = taskKey
    runtime.retryAt = undefined
    await updateDailySyncRun(runtime, { currentTask: taskKey, retryAt: null })
    const started = await startSyncTask(taskKey, attempt, false, true)
    if (!started.started || !started.completion) throw new Error(started.message ?? `${task.label}无法启动。`)
    lastResult = await started.completion
    if (lastResult.status !== 'failed') return lastResult
    if (attempt < attempts - 1) {
      const retryAt = new Date(Date.now() + 15 * 60 * 1000 * (attempt + 1))
      runtime.retryAt = retryAt.toISOString()
      await updateDailySyncRun(runtime, { currentTask: taskKey, retryAt })
      await delay(retryAt.getTime() - Date.now())
    }
  }
  return lastResult
}

async function runDailySync(trigger: DailySyncTrigger): Promise<{ started: boolean; message?: string }> {
  if (!pool) return { started: false, message: '数据库连接未初始化。' }
  if (activeDailySync) return { started: false, message: '盘后同步流程正在执行。' }
  if (activeSyncTasks.size || ingestionProcess) return { started: false, message: '已有其他同步任务运行，请等待其结束后再启动盘后同步。' }
  const { date } = shanghaiNow()
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO aero_sync_pipeline_run (pipeline_key, run_date, trigger_source, status, started_at) VALUES (?, ?, ?, \'running\', CURRENT_TIMESTAMP)',
    ['daily_close', date, trigger],
  )
  const runtime: DailySyncRuntime = { pipelineRunId: Number(result.insertId), trigger, startedAt: new Date().toISOString() }
  activeDailySync = runtime
  void (async () => {
    let finalStatus: IngestionStatus = 'success'
    let failure: string | null = null
    try {
      for (const taskKey of DAILY_SYNC_TASKS) {
        const taskResult = await runDailyTask(runtime, taskKey)
        if (taskResult.status === 'failed') {
          finalStatus = 'failed'
          failure = `${syncTaskDefinitions[taskKey].label}连续尝试后仍未成功。`
          break
        }
        if (taskResult.status === 'partial') finalStatus = 'partial'
      }
    } catch (error) {
      finalStatus = 'failed'
      failure = error instanceof Error ? error.message : '盘后同步流程异常结束。'
    } finally {
      runtime.currentTask = undefined
      runtime.retryAt = undefined
      try { await updateDailySyncRun(runtime, { status: finalStatus, currentTask: null, retryAt: null, finished: true, errorMessage: failure }) } catch { /* 状态写入失败不阻断进程 */ }
      activeDailySync = null
    }
  })()
  return { started: true }
}

async function dailySyncView() {
  const schedule = { enabled: DAILY_SYNC_ENABLED, time: DAILY_SYNC_TIME, timeZone: DAILY_SYNC_TIME_ZONE, tasks: DAILY_SYNC_TASKS }
  if (!pool) return { ...schedule, status: 'idle' as IngestionStatus, running: false }
  if (activeDailySync) return { ...schedule, status: 'running' as IngestionStatus, running: true, trigger: activeDailySync.trigger, startedAt: activeDailySync.startedAt, currentTask: activeDailySync.currentTask, retryAt: activeDailySync.retryAt }
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM aero_sync_pipeline_run WHERE pipeline_key=? ORDER BY id DESC LIMIT 1', ['daily_close'])
  const row = rows[0]
  return {
    ...schedule,
    status: row?.status ?? 'idle', running: false, trigger: row?.trigger_source ?? undefined,
    startedAt: isoOrNull(row?.started_at), finishedAt: isoOrNull(row?.finished_at), currentTask: row?.current_task ?? undefined,
    retryAt: isoOrNull(row?.retry_at), errorMessage: row?.error_message ?? undefined,
  }
}

async function scheduleDailySync() {
  if (!DAILY_SYNC_ENABLED || activeDailySync || !pool) return
  const now = shanghaiNow()
  if (!isWeekday(now.date) || now.time < DAILY_SYNC_TIME) return
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM aero_sync_pipeline_run WHERE pipeline_key=? AND run_date=? AND trigger_source=\'scheduled\' LIMIT 1',
    ['daily_close', now.date],
  )
  if (!rows.length) await runDailySync('scheduled')
}

async function syncTaskViews() {
  if (!pool) return Object.values(syncTaskDefinitions).map((task) => ({ ...task, status: 'idle', recordsWritten: 0, warningCount: 0, running: false }))
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT r.* FROM aero_sync_run r
    INNER JOIN (SELECT task_key, MAX(id) AS id FROM aero_sync_run GROUP BY task_key) latest ON latest.id = r.id
  `)
  const ingestionTaskNames = Object.values(syncTaskDefinitions).map((task) => task.ingestionTaskName).filter(Boolean) as string[]
  const [ingestionRows] = ingestionTaskNames.length ? await pool.query<RowDataPacket[]>(`
    SELECT r.* FROM aero_ingestion_run r
    INNER JOIN (SELECT task_name, MAX(id) AS id FROM aero_ingestion_run WHERE task_name IN (${ingestionTaskNames.map(() => '?').join(',')}) GROUP BY task_name) latest ON latest.id = r.id
  `, ingestionTaskNames) : [[]]
  const latestByKey = new Map(rows.map((row) => [String(row.task_key), row]))
  const latestIngestionByName = new Map(ingestionRows.map((row) => [String(row.task_name), row]))
  return Object.values(syncTaskDefinitions).map((task) => {
    const row = latestByKey.get(task.key)
    const externalRow = task.ingestionTaskName ? latestIngestionByName.get(task.ingestionTaskName) : undefined
    const runtime = activeSyncTasks.get(task.key)
    return {
      key: task.key, label: task.label, description: task.description, cadence: task.cadence,
      status: runtime ? 'running' : row?.status ?? externalRow?.status ?? 'idle', running: Boolean(runtime), syncRunId: runtime?.syncRunId ?? (row ? Number(row.id) : undefined),
      startedAt: runtime ? undefined : isoOrNull(row?.started_at ?? externalRow?.started_at), finishedAt: runtime ? undefined : isoOrNull(row?.finished_at ?? externalRow?.finished_at),
      recordsWritten: runtime?.recordsWritten ?? Number(row?.records_written ?? externalRow?.records_written ?? 0), warningCount: runtime?.warnings ?? Number(row?.warning_count ?? (externalRow?.error_message ? String(externalRow.error_message).split('\n').filter(Boolean).length : 0)),
      retryAt: isoOrNull(row?.retry_at), errorMessage: row?.error_message ? String(row.error_message) : externalRow?.error_message ? String(externalRow.error_message) : undefined,
      retryEnabled: task.retryable, retryAttempt: retryAttempts.get(task.key) ?? 0,
    }
  })
}

type CompanyRow = RowDataPacket & {
  id: number
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
  source_url: string | null
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

function percentValue(value: unknown) {
  return value === null || value === undefined ? null : Number(value)
}

function percentRange(exact: unknown, min: unknown, max: unknown) {
  const single = percentValue(exact)
  const low = percentValue(min)
  const high = percentValue(max)
  if (single !== null && Number.isFinite(single)) return `约 ${single.toFixed(0)}%`
  if (low !== null && high !== null && Number.isFinite(low) && Number.isFinite(high)) return `约 ${low.toFixed(0)}%–${high.toFixed(0)}%`
  if (low !== null && Number.isFinite(low)) return `约 ${low.toFixed(0)}%+`
  return '待确认'
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

async function companySpaceProfile(companyId: number): Promise<CompanySpaceProfile | null> {
  if (!pool) return null
  const [profileRows, businessRows, evidenceRows, revisionRows] = await Promise.all([
    pool.query<RowDataPacket[]>('SELECT * FROM aero_company_space_profile WHERE company_id=?', [companyId]),
    pool.query<RowDataPacket[]>(`
      SELECT b.*, s.sector_name AS secondary_sector, p.sector_name AS primary_sector
      FROM aero_company_space_business b
      INNER JOIN aero_space_sector s ON s.id=b.sector_id
      LEFT JOIN aero_space_sector p ON p.id=s.parent_id
      WHERE b.company_id=? AND b.is_current=1
      ORDER BY FIELD(b.business_role, '核心业务', '重要业务', '相关业务', '概念关联'), b.id
    `, [companyId]),
    pool.query<RowDataPacket[]>(`
      SELECT e.id, e.evidence_title, e.source_name, e.source_url, DATE_FORMAT(e.published_at, '%Y-%m-%d') AS published_at, e.data_state, e.excerpt
      FROM aero_space_business_evidence e INNER JOIN aero_company_space_business b ON b.id=e.business_id
      WHERE b.company_id=? AND e.is_adopted=1 ORDER BY e.published_at DESC, e.id DESC LIMIT 20
    `, [companyId]),
    pool.query<RowDataPacket[]>(`
      SELECT id, entity_type, action_type, field_name, before_value, after_value, change_reason, operator_name, is_manual,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at
      FROM aero_space_profile_revision WHERE company_id=? ORDER BY id DESC LIMIT 30
    `, [companyId]),
  ])
  const profile = profileRows[0][0]
  if (!profile && !businessRows[0].length) return null
  return {
    commercialRevenueShare: profile ? percentRange(profile.commercial_revenue_exact, profile.commercial_revenue_min, profile.commercial_revenue_max) : '待确认',
    commercialRevenueState: (profile?.commercial_revenue_state ?? '待确认') as DataState,
    commercialRevenueConfidence: profile?.commercial_revenue_confidence ?? '低',
    nonSpaceCoreBusinesses: parseStringList(profile?.non_space_core_businesses),
    businessSummary: profile?.business_summary ?? '尚未录入公司商业航天业务画像。',
    updatedAt: profile?.updated_at ? new Date(profile.updated_at).toLocaleDateString('zh-CN').replaceAll('/', '-') : '待确认',
    businesses: businessRows[0].map((row) => ({
      id: String(row.id), primarySector: row.primary_sector ?? row.secondary_sector, secondarySector: row.secondary_sector,
      role: row.business_role, revenueShare: percentRange(row.space_revenue_exact, row.space_revenue_min, row.space_revenue_max),
      companyRevenueShare: percentRange(row.company_revenue_exact, row.company_revenue_min, row.company_revenue_max), status: row.business_status,
      confidence: row.confidence, dataState: row.data_state, chainValue: percentRange(row.chain_value_exact, row.chain_value_min, row.chain_value_max),
      chainImportance: row.chain_importance === null ? null : Number(row.chain_importance), companyImportance: row.company_importance === null ? null : Number(row.company_importance),
      source: row.source_name ?? '来源待补充', sourceUrl: row.source_url, sourceDate: row.source_date ? new Date(row.source_date).toISOString().slice(0, 10) : null, note: row.research_note,
    })),
    evidences: evidenceRows[0].map((row) => ({ id: String(row.id), title: row.evidence_title, source: row.source_name, sourceUrl: row.source_url, publishedAt: row.published_at, dataState: row.data_state, excerpt: row.excerpt ?? '' })),
    revisions: revisionRows[0].map((row) => ({ id: String(row.id), entityType: row.entity_type, action: row.action_type, fieldName: row.field_name, beforeValue: row.before_value ? JSON.stringify(row.before_value) : null, afterValue: row.after_value ? JSON.stringify(row.after_value) : null, reason: row.change_reason, operatorName: row.operator_name, isManual: Boolean(row.is_manual), createdAt: row.created_at })),
  }
}

async function getDatabaseOverview(): Promise<OverviewData> {
  if (!pool) throw new Error('数据库未启用')
  const [companyRows] = await pool.query<CompanyRow[]>(`
    SELECT c.id, c.stock_code, c.company_name, c.related_level,
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
  const profileEntries = await Promise.all(companyRows.map(async (row) => [row.stock_code, await companySpaceProfile(Number(row.id))] as const))
  const profileMap = new Map(profileEntries)
  const [eventRows] = await pool.query<EventRow[]>(`
    SELECT e.id, e.announced_at, c.company_name, c.stock_code, e.event_type, e.title, e.detail, e.risk_level, e.status, a.source_url
    FROM aero_event e
    LEFT JOIN aero_company c ON c.id = e.company_id
    LEFT JOIN aero_announcement a ON a.id = e.announcement_id
    ORDER BY e.announced_at DESC LIMIT 100
  `)
  const riskCodes = new Set(eventRows.filter((event) => event.risk_level === '高').map((event) => event.stock_code))
  const companies: Company[] = companyRows.map((row) => {
    const change = row.change_pct === null ? 0 : Number(row.change_pct)
    const signal = signalFor(change, Boolean(row.stock_code && riskCodes.has(row.stock_code)))
    const spark = row.prices?.split(',').map(Number).filter(Number.isFinite) ?? []
    return {
      code: row.stock_code, name: row.company_name, level: row.related_level, industry: row.industry ?? '待补充', concept: row.concept ?? '待补充',
      price: decimal(row.close_price), change, marketCap: marketCap(row.market_cap), tags: [], spark: spark.length ? spark : [0], spaceProfile: profileMap.get(row.stock_code) ?? undefined, ...signal,
    }
  })
  const events: EventItem[] = eventRows.map((row) => ({
    id: `evt-${row.id}`, time: time(row.announced_at), company: row.company_name ?? '市场事件', code: row.stock_code ?? '--', type: row.event_type,
    title: row.title, detail: row.detail ?? '暂无事件摘要。', level: row.risk_level, ...(row.status ? { status: row.status } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
  }))
  const [spaceBoardRows] = await pool.query<RowDataPacket[]>(`
    SELECT s.sector_name, s.sector_level, d.equal_change_pct, d.weighted_change_pct, d.rising_count, d.falling_count, d.flat_count,
      d.high_exposure_count, d.concentration_state, leader.company_name AS leader_name, contributor.company_name AS contributor_name
    FROM aero_space_sector_daily d
    INNER JOIN aero_space_sector s ON s.id=d.sector_id
    LEFT JOIN aero_company leader ON leader.id=d.leader_company_id
    LEFT JOIN aero_company contributor ON contributor.id=d.top_contributor_company_id
    WHERE d.trade_date=(SELECT MAX(trade_date) FROM aero_space_sector_daily)
    ORDER BY d.equal_change_pct DESC LIMIT 12
  `)
  const [boardRows] = await pool.query<RowDataPacket[]>(`
    SELECT board_name, change_pct, rising_count, falling_count, leader_name
    FROM aero_board_quote WHERE trade_date = (SELECT MAX(trade_date) FROM aero_board_quote)
    ORDER BY change_pct DESC LIMIT 8
  `)
  const [macroRows] = await pool.query<RowDataPacket[]>(`
    SELECT m.indicator_name, m.value, m.value_text, m.change_pct, m.unit
    FROM aero_macro_indicator m
    INNER JOIN (SELECT indicator_key, MAX(observed_date) AS max_date FROM aero_macro_indicator GROUP BY indicator_key) latest
      ON latest.indicator_key = m.indicator_key AND latest.max_date = m.observed_date
    ORDER BY m.indicator_name LIMIT 12
  `)
  const latestQuote = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS trade_date FROM aero_daily_quote")
  const asOf = latestQuote[0][0]?.trade_date ? `${latestQuote[0][0].trade_date} 盘后` : '尚未导入行情数据'
  const positive = companies.filter((company) => company.change > 0).length
  return {
    asOf,
    coverage: `${companies.length} 家航天相关 A 股`,
    companies,
    events,
    boards: spaceBoardRows.length ? spaceBoardRows.map((row) => ({
      name: row.sector_name, change: Number(row.equal_change_pct ?? 0), breadth: `${row.rising_count ?? 0} / ${row.falling_count ?? 0}`,
      leader: row.leader_name ?? '待补充', boardType: Number(row.sector_level) === 1 ? '一级板块' : '二级板块', fallingCount: Number(row.falling_count ?? 0), flatCount: Number(row.flat_count ?? 0),
      weightedChange: row.weighted_change_pct === null ? null : Number(row.weighted_change_pct), exposure: `高暴露 ${Number(row.high_exposure_count ?? 0)} 家`, contributor: row.contributor_name ?? '待补充', concentration: row.concentration_state,
    })) : boardRows.map((row) => ({ name: row.board_name, change: Number(row.change_pct ?? 0), breadth: `${row.rising_count ?? 0} / ${(row.rising_count ?? 0) + (row.falling_count ?? 0)}`, leader: row.leader_name ?? '待补充', boardType: '主题' as const })),
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
    if (!latestRunId) {
      const ingestionTaskName = syncTaskDefinitions[taskKey].ingestionTaskName
      if (!ingestionTaskName) return res.json({ items: [], runId: null })
      const [externalRows] = await pool.query<RowDataPacket[]>(
        'SELECT status, started_at, finished_at, records_written, error_message FROM aero_ingestion_run WHERE task_name=? ORDER BY id DESC LIMIT 1', [ingestionTaskName],
      )
      const external = externalRows[0]
      if (!external) return res.json({ items: [], runId: null })
      const startedAt = isoOrNull(external.started_at)
      const items = [
        { id: -1, level: 'info', message: `历史命令任务：状态 ${external.status}，写入 ${Number(external.records_written ?? 0)} 条。`, createdAt: startedAt },
        ...String(external.error_message ?? '').split('\n').filter(Boolean).map((message, index) => ({ id: -(index + 2), level: 'error', message, createdAt: isoOrNull(external.finished_at) })),
      ]
      return res.json({ items, runId: null, source: 'aero_ingestion_run' })
    }
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

app.get('/api/sync/daily', async (_req, res) => {
  try {
    res.json(await dailySyncView())
  } catch (error) {
    res.status(503).json({ error: '无法读取盘后同步状态', detail: error instanceof Error ? error.message : '未知错误' })
  }
})

app.post('/api/sync/daily/run', async (_req, res) => {
  try {
    const result = await runDailySync('manual')
    if (!result.started) return res.status(409).json({ error: result.message })
    return res.status(202).json({ status: 'running', message: '盘后同步已启动：行情与估值完成后将自动聚合板块。' })
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : '盘后同步启动失败。' })
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
  if (!dbEnabled || !pool) {
    const company = demoOverview.companies.find((item) => item.code === code)
    if (!company) return res.status(404).json({ error: '未找到该公司。' })
    const profile = demoProfiles[code]
    return res.json({
      company: { code, name: company.name, exchange: code.startsWith('6') ? '上交所' : '深交所', level: company.level, description: profile?.businessSummary ?? null, latestQuote: { tradeDate: '2026-07-10', open: company.price, high: company.price, low: company.price, close: company.price, change: company.change, volume: null, turnover: null, turnoverRate: null, marketCap: company.marketCap, peTtm: '--', pb: '--', source: '演示数据' } },
      tags: company.tags.map((name) => ({ type: '业务标签', name })), quotes: [],
      events: demoOverview.events.filter((item) => item.code === code).map((item, index) => ({ id: index + 1, type: item.type, status: item.status, level: item.level, title: item.title, detail: item.detail, announcedAt: `2026-07-10 ${item.time}` })),
      facts: [], profile,
    })
  }
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
    const [tagRows, quoteRows, eventRows, factRows, profile] = await Promise.all([
      pool.query<RowDataPacket[]>('SELECT tag_type, tag_name FROM aero_company_tag WHERE company_id = ? AND (effective_to IS NULL OR effective_to >= CURDATE()) ORDER BY tag_type, tag_name', [company.id]),
      pool.query<RowDataPacket[]>('SELECT DATE_FORMAT(trade_date, \'%Y-%m-%d\') AS trade_date, open_price, high_price, low_price, close_price, change_pct, volume, turnover, turnover_rate FROM aero_daily_quote WHERE company_id = ? ORDER BY trade_date DESC LIMIT 20', [company.id]),
      pool.query<RowDataPacket[]>('SELECT id, event_type, status, risk_level, title, detail, DATE_FORMAT(announced_at, \'%Y-%m-%d %H:%i\') AS announced_at FROM aero_event WHERE company_id = ? ORDER BY announced_at DESC LIMIT 8', [company.id]),
      pool.query<RowDataPacket[]>('SELECT fact_type, title, content, fact_state, DATE_FORMAT(disclosed_at, \'%Y-%m-%d\') AS disclosed_at, source_name, source_url FROM aero_business_fact WHERE company_id = ? ORDER BY disclosed_at DESC, id DESC LIMIT 8', [company.id]),
      companySpaceProfile(Number(company.id)),
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
      facts: factRows[0].map((row) => ({ type: row.fact_type, title: row.title, content: row.content, state: row.fact_state, disclosedAt: row.disclosed_at, source: row.source_name, sourceUrl: row.source_url })), profile,
    })
  } catch (error) { res.status(503).json({ error: '公司详情查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.put('/api/companies/:code/space-profile', async (req, res) => {
  const code = String(req.params.code ?? '').trim()
  if (!dbEnabled || !pool) return res.status(400).json({ error: '人工维护需要启用 MySQL 数据模式。' })
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '股票代码格式不正确。' })
  const body = req.body as Record<string, unknown>
  const allowedStates = new Set(['明确披露', '公开资料推算', '研究估计', '待确认', '无法确认'])
  const allowedConfidence = new Set(['高', '中', '低'])
  const asNumber = (value: unknown) => value === '' || value === null || value === undefined ? null : Number(value)
  const values = {
    exact: asNumber(body.commercialRevenueExact), min: asNumber(body.commercialRevenueMin), max: asNumber(body.commercialRevenueMax),
    state: typeof body.commercialRevenueState === 'string' && allowedStates.has(body.commercialRevenueState) ? body.commercialRevenueState : '待确认',
    confidence: typeof body.commercialRevenueConfidence === 'string' && allowedConfidence.has(body.commercialRevenueConfidence) ? body.commercialRevenueConfidence : '低',
    nonSpace: Array.isArray(body.nonSpaceCoreBusinesses) ? body.nonSpaceCoreBusinesses.filter((item): item is string => typeof item === 'string') : [],
    summary: typeof body.businessSummary === 'string' ? body.businessSummary.slice(0, 8000) : null,
    sourceName: typeof body.sourceName === 'string' ? body.sourceName.slice(0, 128) : null,
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 1024) : null,
    sourceDate: typeof body.sourceDate === 'string' ? body.sourceDate : null,
    operator: typeof body.operatorName === 'string' ? body.operatorName.slice(0, 64) : '研究员',
    reason: typeof body.changeReason === 'string' ? body.changeReason.slice(0, 8000) : '人工维护画像',
  }
  if ([values.exact, values.min, values.max].some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100))) return res.status(400).json({ error: '收入占比应为 0–100 的数值。' })
  try {
    const [companyRows] = await pool.query<RowDataPacket[]>('SELECT id FROM aero_company WHERE stock_code=? AND is_active=1 LIMIT 1', [code])
    const company = companyRows[0]
    if (!company) return res.status(404).json({ error: '未找到该公司。' })
    const [oldRows] = await pool.query<RowDataPacket[]>('SELECT * FROM aero_company_space_profile WHERE company_id=?', [company.id])
    await pool.execute(`
      INSERT INTO aero_company_space_profile (company_id, commercial_revenue_exact, commercial_revenue_min, commercial_revenue_max, commercial_revenue_state, commercial_revenue_confidence, non_space_core_businesses, business_summary, source_name, source_url, source_date, updated_by, is_manual_confirmed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE commercial_revenue_exact=VALUES(commercial_revenue_exact), commercial_revenue_min=VALUES(commercial_revenue_min), commercial_revenue_max=VALUES(commercial_revenue_max), commercial_revenue_state=VALUES(commercial_revenue_state), commercial_revenue_confidence=VALUES(commercial_revenue_confidence), non_space_core_businesses=VALUES(non_space_core_businesses), business_summary=VALUES(business_summary), source_name=VALUES(source_name), source_url=VALUES(source_url), source_date=VALUES(source_date), updated_by=VALUES(updated_by), is_manual_confirmed=1
    `, [company.id, values.exact, values.min, values.max, values.state, values.confidence, JSON.stringify(values.nonSpace), values.summary, values.sourceName, values.sourceUrl, values.sourceDate, values.operator])
    await pool.execute('INSERT INTO aero_space_profile_revision (company_id, entity_type, action_type, field_name, before_value, after_value, change_reason, operator_name, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)', [company.id, '公司画像', oldRows[0].length ? '更新' : '新增', '商业航天收入与主营业务', oldRows[0].length ? JSON.stringify(oldRows[0][0]) : null, JSON.stringify(values), values.reason, values.operator])
    res.json({ profile: await companySpaceProfile(Number(company.id)) })
  } catch (error) { res.status(503).json({ error: '画像保存失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.post('/api/companies/:code/space-businesses', async (req, res) => {
  const code = String(req.params.code ?? '').trim()
  if (!dbEnabled || !pool) return res.status(400).json({ error: '人工维护需要启用 MySQL 数据模式。' })
  const body = req.body as Record<string, unknown>
  const sectorCode = typeof body.sectorCode === 'string' ? body.sectorCode : ''
  const role = typeof body.role === 'string' ? body.role : ''
  if (!/^\d{6}$/.test(code) || !sectorCode || !['核心业务', '重要业务', '相关业务', '概念关联'].includes(role)) return res.status(400).json({ error: '请提供有效的公司、二级板块编码和业务角色。' })
  try {
    const [[companyRows], [sectorRows]] = await Promise.all([
      pool.query<RowDataPacket[]>('SELECT id FROM aero_company WHERE stock_code=? AND is_active=1 LIMIT 1', [code]),
      pool.query<RowDataPacket[]>('SELECT id FROM aero_space_sector WHERE sector_code=? AND sector_level=2 AND is_active=1 LIMIT 1', [sectorCode]),
    ])
    const company = companyRows[0]; const sector = sectorRows[0]
    if (!company || !sector) return res.status(404).json({ error: !company ? '未找到该公司。' : '未找到对应二级板块。' })
    const asNumber = (value: unknown) => value === '' || value === null || value === undefined ? null : Number(value)
    const [result] = await pool.execute<ResultSetHeader>(`INSERT INTO aero_company_space_business (company_id, sector_id, business_role, business_status, space_revenue_exact, space_revenue_min, space_revenue_max, company_revenue_exact, company_revenue_min, company_revenue_max, data_state, confidence, chain_scope, chain_value_min, chain_value_max, chain_value_basis, chain_importance, company_importance, source_name, source_url, source_date, research_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [company.id, sector.id, role, typeof body.status === 'string' ? body.status : '待确认', asNumber(body.spaceRevenueExact), asNumber(body.spaceRevenueMin), asNumber(body.spaceRevenueMax), asNumber(body.companyRevenueExact), asNumber(body.companyRevenueMin), asNumber(body.companyRevenueMax), typeof body.dataState === 'string' ? body.dataState : '待确认', typeof body.confidence === 'string' ? body.confidence : '低', typeof body.chainScope === 'string' ? body.chainScope : null, asNumber(body.chainValueMin), asNumber(body.chainValueMax), typeof body.chainValueBasis === 'string' ? body.chainValueBasis : null, asNumber(body.chainImportance), asNumber(body.companyImportance), typeof body.sourceName === 'string' ? body.sourceName : null, typeof body.sourceUrl === 'string' ? body.sourceUrl : null, typeof body.sourceDate === 'string' ? body.sourceDate : null, typeof body.researchNote === 'string' ? body.researchNote : null])
    const operator = typeof body.operatorName === 'string' ? body.operatorName.slice(0, 64) : '研究员'
    await pool.execute('INSERT INTO aero_space_profile_revision (company_id, entity_type, entity_id, action_type, after_value, change_reason, operator_name, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [company.id, '商业航天业务', result.insertId, '新增', JSON.stringify(body), typeof body.changeReason === 'string' ? body.changeReason : '人工新增业务关联', operator])
    res.status(201).json({ profile: await companySpaceProfile(Number(company.id)) })
  } catch (error) { res.status(503).json({ error: '业务关联保存失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.patch('/api/companies/:code/space-businesses/:businessId', async (req, res) => {
  const code = String(req.params.code ?? '').trim()
  const businessId = Number(req.params.businessId)
  if (!dbEnabled || !pool) return res.status(400).json({ error: '人工维护需要启用 MySQL 数据模式。' })
  if (!/^\d{6}$/.test(code) || !Number.isInteger(businessId) || businessId < 1) return res.status(400).json({ error: '公司或业务关联标识不正确。' })
  const body = req.body as Record<string, unknown>
  const textValue = (key: string, length: number) => typeof body[key] === 'string' ? body[key].slice(0, length) : undefined
  const numberValue = (key: string) => body[key] === null || body[key] === '' ? null : typeof body[key] === 'number' && Number.isFinite(body[key]) ? body[key] : undefined
  const candidates: Array<[string, unknown]> = [
    ['business_role', textValue('role', 16)], ['business_status', textValue('status', 32)], ['data_state', textValue('dataState', 24)], ['confidence', textValue('confidence', 8)],
    ['space_revenue_exact', numberValue('spaceRevenueExact')], ['space_revenue_min', numberValue('spaceRevenueMin')], ['space_revenue_max', numberValue('spaceRevenueMax')],
    ['company_revenue_exact', numberValue('companyRevenueExact')], ['company_revenue_min', numberValue('companyRevenueMin')], ['company_revenue_max', numberValue('companyRevenueMax')],
    ['chain_value_exact', numberValue('chainValueExact')], ['chain_value_min', numberValue('chainValueMin')], ['chain_value_max', numberValue('chainValueMax')],
    ['chain_scope', textValue('chainScope', 128)], ['chain_value_basis', textValue('chainValueBasis', 128)], ['chain_importance', numberValue('chainImportance')], ['company_importance', numberValue('companyImportance')],
    ['source_name', textValue('sourceName', 128)], ['source_url', textValue('sourceUrl', 1024)], ['source_date', textValue('sourceDate', 10)], ['research_note', textValue('researchNote', 8000)],
  ]
  const fields = candidates.reduce<Array<[string, unknown]>>((result, [field, value]) => { if (value !== undefined) result.push([field, value]); return result }, [])
  if (!fields.length) return res.status(400).json({ error: '没有可更新的字段。' })
  if (fields.some(([field, value]) => field.includes('revenue') && value !== null && (typeof value !== 'number' || value < 0 || value > 100))) return res.status(400).json({ error: '收入占比应为 0–100 的数值。' })
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT b.*, c.id AS company_id FROM aero_company_space_business b INNER JOIN aero_company c ON c.id=b.company_id WHERE b.id=? AND c.stock_code=? AND c.is_active=1 LIMIT 1`, [businessId, code])
    const old = rows[0]
    if (!old) return res.status(404).json({ error: '未找到该公司业务关联。' })
    const sql = `UPDATE aero_company_space_business SET ${fields.map(([field]) => `${field}=?`).join(', ')} WHERE id=?`
    await pool.query(sql, [...fields.map(([, value]) => value), businessId])
    const operator = textValue('operatorName', 64) ?? '研究员'
    await pool.execute('INSERT INTO aero_space_profile_revision (company_id, entity_type, entity_id, action_type, before_value, after_value, change_reason, operator_name, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)', [old.company_id, '商业航天业务', businessId, '更新', JSON.stringify(old), JSON.stringify(Object.fromEntries(fields)), textValue('changeReason', 8000) ?? '人工修改业务关联', operator])
    res.json({ profile: await companySpaceProfile(Number(old.company_id)) })
  } catch (error) { res.status(503).json({ error: '业务关联更新失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})
app.get('/api/events', async (_req, res) => {
  try { const data = await overview(); res.json({ items: data.events, dataMode: data.dataMode }) } catch (error) { res.status(503).json({ error: '数据库查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.get('/api/reports', async (_req, res) => {
  if (!dbEnabled || !pool) return res.json({ items: [], dataMode: 'demo' as const })
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS report_date, report_type, status, markdown_path, pdf_path,
        DATE_FORMAT(generated_at, '%Y-%m-%d %H:%i') AS generated_at
      FROM aero_report ORDER BY report_date DESC LIMIT 30
    `)
    res.json({
      items: rows.map((row) => ({
        reportDate: String(row.report_date),
        reportType: row.report_type,
        status: row.status,
        hasMarkdown: Boolean(row.markdown_path),
        hasPdf: Boolean(row.pdf_path),
        generatedAt: row.generated_at,
      })),
      dataMode: 'mysql' as const,
    })
  } catch (error) { res.status(503).json({ error: '日报列表查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.get('/api/reports/:date', async (req, res) => {
  const date = String(req.params.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式不正确，应为 YYYY-MM-DD。' })
  if (!dbEnabled || !pool) return res.status(400).json({ error: '当前为演示模式，日报需要启用 MySQL。' })
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS report_date, report_type, status, markdown_path, pdf_path,
        generated_at
      FROM aero_report WHERE report_date=? AND report_type=? LIMIT 1
    `, [date, 'daily'])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: '未找到该日期的日报。' })
    let markdown: string | null = null
    if (row.markdown_path) {
      try { markdown = await import('node:fs/promises').then((fs) => fs.readFile(row.markdown_path, 'utf-8')) } catch { markdown = null }
    }
    res.json({
      report: {
        reportDate: String(row.report_date), reportType: row.report_type, status: row.status,
        hasMarkdown: Boolean(row.markdown_path), hasPdf: Boolean(row.pdf_path),
        generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : undefined,
      },
      markdown,
      dataMode: 'mysql' as const,
    })
  } catch (error) { res.status(503).json({ error: '日报详情查询失败', detail: error instanceof Error ? error.message : '未知错误' }) }
})

app.post('/api/reports/generate', async (_req, res) => {
  const taskKey = 'report' as SyncTaskKey
  if (!dbEnabled) return res.status(400).json({ error: '当前为演示模式，请先在 .env 中设置 DB_ENABLED=true。' })
  try {
    const result = await startSyncTask(taskKey)
    if (!result.started) return res.status(409).json({ error: result.message })
    return res.status(202).json({ status: 'running', message: '日报生成已启动。' })
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : '日报生成启动失败。' })
  }
})

app.listen(port, () => {
  console.log(`Aero API listening on http://localhost:${port} (${dbEnabled ? 'mysql' : 'demo'} mode)`)
  void scheduleDailySync()
  setInterval(() => { void scheduleDailySync() }, 60_000)
})
