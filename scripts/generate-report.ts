import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'

if (process.env.DB_ENABLED !== 'true') throw new Error('请先在 .env 中设置 DB_ENABLED=true。')

// --- 参数解析 ---
const args = process.argv.slice(2).filter((item) => item !== '--')
const forceFlag = args.includes('--force')
const dateIndex = args.indexOf('--date')
const rawDate = dateIndex >= 0 && args[dateIndex + 1] ? args[dateIndex + 1] : ''
const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toLocaleDateString('en-CA', { timeZone: process.env.DB_TIMEZONE === 'Asia/Shanghai' ? 'Asia/Shanghai' : undefined })

const REPORT_TYPE = 'daily'
const REPORT_DIR = resolve(process.cwd(), process.env.REPORT_DIR ?? 'reports')

// --- 数据库连接 ---
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
})

type CompanyQuoteRow = RowDataPacket & {
  stock_code: string
  company_name: string
  related_level: string
  close_price: number | null
  change_pct: number | null
  market_cap: number | null
}

type EventRow = RowDataPacket & {
  announced_at: Date | string
  company_name: string | null
  stock_code: string | null
  event_type: string
  title: string
  risk_level: '高' | '中' | '低'
  status: string | null
  source_url: string | null
}

type SpaceBoardRow = RowDataPacket & {
  sector_name: string
  sector_level: number
  equal_change_pct: number | null
  weighted_change_pct: number | null
  rising_count: number
  falling_count: number
  flat_count: number
  leader_name: string | null
  contributor_name: string | null
  concentration_state: string
}

type BoardRow = RowDataPacket & {
  board_name: string
  change_pct: number | null
  rising_count: number | null
  falling_count: number | null
  leader_name: string | null
}

type MacroRow = RowDataPacket & {
  indicator_name: string
  value: number | null
  value_text: string | null
  change_pct: number | null
  unit: string | null
}

const pct = (value: number | null, digits = 2) => (value === null ? '--' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%`)
const num = (value: number | null, digits = 2) => (value === null ? '--' : Number(value).toFixed(digits))
const marketCapStr = (value: number | null) => (value === null ? '--' : `${(Number(value) / 100_000_000).toFixed(1)} 亿`)

async function fetchReportData(date: string) {
  const [companyRows] = await connection.query<CompanyQuoteRow[]>(`
    SELECT c.stock_code, c.company_name, c.related_level, q.close_price, q.change_pct, q.market_cap
    FROM aero_company c
    LEFT JOIN aero_daily_quote q ON q.company_id = c.id AND q.trade_date = ?
    WHERE c.is_active = 1
    ORDER BY c.stock_code
  `, [date])

  const [eventRows] = await connection.query<EventRow[]>(`
    SELECT e.announced_at, c.company_name, c.stock_code, e.event_type, e.title, e.risk_level, e.status, a.source_url
    FROM aero_event e
    LEFT JOIN aero_company c ON c.id = e.company_id
    LEFT JOIN aero_announcement a ON a.id = e.announcement_id
    WHERE DATE(e.announced_at) = ? OR e.announced_at >= ?
    ORDER BY e.announced_at DESC LIMIT 50
  `, [date, `${date} 00:00:00`])

  const [spaceBoardRows] = await connection.query<SpaceBoardRow[]>(`
    SELECT s.sector_name, s.sector_level, d.equal_change_pct, d.weighted_change_pct,
      d.rising_count, d.falling_count, d.flat_count, d.concentration_state,
      leader.company_name AS leader_name, contributor.company_name AS contributor_name
    FROM aero_space_sector_daily d
    INNER JOIN aero_space_sector s ON s.id = d.sector_id
    LEFT JOIN aero_company leader ON leader.id = d.leader_company_id
    LEFT JOIN aero_company contributor ON contributor.id = d.top_contributor_company_id
    WHERE d.trade_date = ?
    ORDER BY d.equal_change_pct DESC
  `, [date])

  const [boardRows] = await connection.query<BoardRow[]>(`
    SELECT board_name, change_pct, rising_count, falling_count, leader_name
    FROM aero_board_quote WHERE trade_date = ?
    ORDER BY change_pct DESC LIMIT 10
  `, [date])

  const [macroRows] = await connection.query<MacroRow[]>(`
    SELECT indicator_name, value, value_text, change_pct, unit
    FROM aero_macro_indicator
    WHERE observed_date = (SELECT MAX(observed_date) FROM aero_macro_indicator)
    ORDER BY indicator_name LIMIT 12
  `)

  return { companyRows, eventRows, spaceBoardRows, boardRows, macroRows }
}

function buildMarkdown(date: string, data: Awaited<ReturnType<typeof fetchReportData>>): string {
  const { companyRows, eventRows, spaceBoardRows, boardRows, macroRows } = data
  const lines: string[] = []

  // --- 头部 ---
  lines.push(`# 轨道观察 · 盘后简报 / ${date}`)
  lines.push('')
  const companyCount = companyRows.length
  const withQuote = companyRows.filter((row) => row.change_pct !== null)
  const rising = withQuote.filter((row) => Number(row.change_pct) > 0)
  const falling = withQuote.filter((row) => Number(row.change_pct) < 0)
  const flat = withQuote.filter((row) => Number(row.change_pct) === 0)
  const avgChange = withQuote.length ? withQuote.reduce((sum, row) => sum + Number(row.change_pct), 0) / withQuote.length : 0
  lines.push(`> 数据截止：${date} 盘后 · 覆盖 ${companyCount} 家航天相关 A 股`)
  lines.push(`> 信息工具，不构成投资建议`)
  lines.push('')

  // --- 一、公司池概况 ---
  lines.push('## 一、公司池概况')
  lines.push('')
  lines.push(`- 上涨 ${rising.length} 家 / 下跌 ${falling.length} 家 / 平盘 ${flat.length} 家 · 平均涨跌 ${pct(avgChange)}`)
  const sorted = [...withQuote].sort((a, b) => Number(b.change_pct) - Number(a.change_pct))
  const top5 = sorted.slice(0, 5)
  const bottom5 = sorted.slice(-5).reverse()
  if (top5.length) {
    lines.push(`- **涨幅前五**：${top5.map((row) => `${row.company_name} ${pct(row.change_pct)}`).join(' · ')}`)
  }
  if (bottom5.length) {
    lines.push(`- **跌幅前五**：${bottom5.map((row) => `${row.company_name} ${pct(row.change_pct)}`).join(' · ')}`)
  }
  lines.push('')

  // --- 二、商业航天板块表现 ---
  lines.push('## 二、商业航天板块表现')
  lines.push('')
  const boards = spaceBoardRows.length ? spaceBoardRows : []
  if (boards.length) {
    const topBoards = boards.slice(0, 5)
    const bottomBoards = boards.slice(-3).reverse()
    lines.push('| 板块 | 类型 | 等权涨跌 | 加权涨跌 | 广度 | 主要贡献 |')
    lines.push('|---|---|---|---|---|---|')
    for (const row of [...topBoards, ...(bottomBoards.length > 3 ? bottomBoards : [])]) {
      const level = Number(row.sector_level) === 1 ? '一级' : '二级'
      const breadth = `${row.rising_count}涨/${row.falling_count}跌`
      lines.push(`| ${row.sector_name} | ${level} | ${pct(row.equal_change_pct)} | ${pct(row.weighted_change_pct)} | ${breadth} | ${row.contributor_name ?? '--'} |`)
    }
    lines.push('')
    const risingBoards = boards.filter((row) => Number(row.equal_change_pct) > 0).length
    const fallingBoards = boards.filter((row) => Number(row.equal_change_pct) < 0).length
    lines.push(`> 板块广度：${risingBoards} 个板块上涨 / ${fallingBoards} 个板块下跌`)
    lines.push('')
  } else if (boardRows.length) {
    lines.push('| 板块 | 涨跌 | 广度 | 领涨 |')
    lines.push('|---|---|---|---|')
    for (const row of boardRows.slice(0, 8)) {
      lines.push(`| ${row.board_name} | ${pct(row.change_pct)} | ${(row.rising_count ?? 0)}涨/${(row.falling_count ?? 0)}跌 | ${row.leader_name ?? '--'} |`)
    }
    lines.push('')
  } else {
    lines.push('> 今日暂无板块数据。')
    lines.push('')
  }

  // --- 三、重要事件 ---
  lines.push('## 三、重要事件')
  lines.push('')
  if (eventRows.length) {
    const highEvents = eventRows.filter((row) => row.risk_level === '高')
    const midEvents = eventRows.filter((row) => row.risk_level === '中')
    const lowEvents = eventRows.filter((row) => row.risk_level === '低')
    const sections: Array<[string, typeof eventRows]> = [
      [`高风险（${highEvents.length} 条）`, highEvents],
      [`中风险（${midEvents.length} 条）`, midEvents],
      [`低风险（${lowEvents.length} 条）`, lowEvents],
    ]
    for (const [heading, events] of sections) {
      if (!events.length) continue
      lines.push(`### ${heading}`)
      lines.push('')
      for (const row of events.slice(0, 15)) {
        const company = row.company_name ?? '市场事件'
        const code = row.stock_code ?? '--'
        const status = row.status ? ` [状态：${row.status}]` : ''
        const link = row.source_url ? `[原文](${row.source_url})` : ''
        lines.push(`- **${company}（${code}）·${row.event_type}** ${row.title}${status} ${link}`)
      }
      lines.push('')
    }
  } else {
    lines.push('> 今日暂无重大事项。')
    lines.push('')
  }

  // --- 四、宏观环境 ---
  lines.push('## 四、宏观环境')
  lines.push('')
  if (macroRows.length) {
    lines.push('| 指标 | 数值 | 环比 |')
    lines.push('|---|---|---|')
    for (const row of macroRows) {
      const value = row.value_text ?? (row.value !== null ? `${num(row.value, 4)}${row.unit ?? ''}` : '--')
      const change = row.change_pct === null ? '暂无环比' : pct(row.change_pct)
      lines.push(`| ${row.indicator_name} | ${value} | ${change} |`)
    }
    lines.push('')
  } else {
    lines.push('> 暂无宏观数据。')
    lines.push('')
  }

  // --- 五、研究观察 ---
  lines.push('## 五、研究观察')
  lines.push('')
  const observations: string[] = []
  // 1. 板块强度
  if (boards.length) {
    const topBoard = boards[0]
    const risingRate = boards.length ? (boards.filter((row) => Number(row.equal_change_pct) > 0).length / boards.length) * 100 : 0
    observations.push(`**板块强度**：${boards.length} 个细分板块中 ${risingRate.toFixed(0)}% 上涨，领涨板块"${topBoard.sector_name}"等权涨跌 ${pct(topBoard.equal_change_pct)}，主要贡献来自 ${topBoard.contributor_name ?? '多公司合力'}。`)
  } else {
    observations.push(`**板块强度**：公司池 ${rising.length} 家上涨，平均涨跌 ${pct(avgChange)}。`)
  }
  // 2. 事件风险
  const highCount = eventRows.filter((row) => row.risk_level === '高').length
  const reductionEvents = eventRows.filter((row) => row.event_type === '减持')
  if (highCount > 0) {
    observations.push(`**事件风险**：当前有 ${highCount} 条高风险事项${reductionEvents.length ? `，其中 ${reductionEvents.length} 条减持需关注进展` : ''}，建议结合原公告复核。`)
  } else {
    observations.push(`**事件风险**：今日无高风险事项${eventRows.length ? `，共 ${eventRows.length} 条事件已归档` : ''}。`)
  }
  // 3. 宏观背景
  if (macroRows.length) {
    const omoRow = macroRows.find((row) => row.indicator_name.includes('OMO'))
    const indexRow = macroRows.find((row) => row.indicator_name.includes('上证') || row.indicator_name.includes('沪深'))
    const macroParts: string[] = []
    if (omoRow) macroParts.push(`OMO ${omoRow.value_text ?? num(omoRow.value, 2)}`)
    if (indexRow) macroParts.push(`${indexRow.indicator_name} ${pct(indexRow.change_pct)}`)
    observations.push(`**宏观背景**：${macroParts.join(' · ') || '主要指数与宏观指标已更新'}。`)
  } else {
    observations.push(`**宏观背景**：宏观指标暂未接入。`)
  }
  observations.forEach((observation, index) => {
    lines.push(`${index + 1}. ${observation}`)
  })
  lines.push('')

  // --- 页脚 ---
  lines.push('---')
  lines.push('')
  lines.push(`*数据截止 ${date} 盘后 · 由轨道观察自动生成 · 信息工具，不构成投资建议*`)
  lines.push('')

  return lines.join('\n')
}

try {
  // 检查是否已存在且非 force
  const [existing] = await connection.query<RowDataPacket[]>(
    'SELECT id, content_hash FROM aero_report WHERE report_date=? AND report_type=? LIMIT 1',
    [reportDate, REPORT_TYPE],
  )
  if (existing.length && !forceFlag) {
    console.log(`日报 ${reportDate} 已存在；如需重新生成请传入 --force。`)
    await connection.end()
    process.exit(0)
  }

  const data = await fetchReportData(reportDate)
  const markdown = buildMarkdown(reportDate, data)
  const contentHash = createHash('sha256').update(markdown).digest('hex')

  // 写入文件
  const dateDir = join(REPORT_DIR, reportDate)
  await mkdir(dateDir, { recursive: true })
  const markdownPath = join(dateDir, 'daily.md')
  await writeFile(markdownPath, markdown, 'utf-8')

  // 写入数据库
  await connection.execute(
    `INSERT INTO aero_report (report_date, report_type, markdown_path, pdf_path, status, data_cutoff_at, content_hash, generated_at)
     VALUES (?, ?, ?, NULL, 'generated', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE markdown_path=VALUES(markdown_path), status=VALUES(status), content_hash=VALUES(content_hash), generated_at=CURRENT_TIMESTAMP`,
    [reportDate, REPORT_TYPE, markdownPath, contentHash],
  )

  console.log(`完成：写入 1 条，0 个告警。`)
  console.log(`日报已生成：${markdownPath}`)
} catch (error) {
  console.error(`日报生成失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await connection.end()
}
