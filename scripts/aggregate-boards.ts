import 'dotenv/config'
import mysql, { type RowDataPacket } from 'mysql2/promise'

if (process.env.DB_ENABLED !== 'true') throw new Error('请先在 .env 中设置 DB_ENABLED=true。')

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
})

type BoardRow = RowDataPacket & {
  board_key: string
  board_name: string
  trade_date: string
  change_pct: number | null
  rising_count: number
  falling_count: number
  leader_code: string | null
  leader_name: string | null
}

type SpaceBoardRow = RowDataPacket & {
  sector_id: number
  trade_date: string
  equal_change_pct: number | null
  weighted_change_pct: number | null
  rising_count: number
  falling_count: number
  flat_count: number
  high_exposure_count: number
  leader_company_id: number | null
  laggard_company_id: number | null
  top_contributor_company_id: number | null
  concentration_state: '集中' | '均衡' | '待确认'
}

try {
  const [rows] = await connection.query<BoardRow[]>(`
    WITH latest_quote AS (
      SELECT q.company_id, q.trade_date, q.change_pct
      FROM aero_daily_quote q
      INNER JOIN (
        SELECT company_id, MAX(trade_date) AS trade_date
        FROM aero_daily_quote
        GROUP BY company_id
      ) latest ON latest.company_id = q.company_id AND latest.trade_date = q.trade_date
    ), grouped AS (
      SELECT
        'watchlist' AS board_key,
        '航天相关公司池' AS board_name,
        q.trade_date,
        q.change_pct,
        c.stock_code,
        c.company_name
      FROM aero_company c
      INNER JOIN latest_quote q ON q.company_id = c.id
      WHERE c.is_active = 1 AND q.change_pct IS NOT NULL
      UNION ALL
      SELECT
        CONCAT('industry-', t.tag_name) AS board_key,
        t.tag_name AS board_name,
        q.trade_date,
        q.change_pct,
        c.stock_code,
        c.company_name
      FROM aero_company c
      INNER JOIN latest_quote q ON q.company_id = c.id
      INNER JOIN aero_company_tag t ON t.company_id = c.id
        AND t.tag_type = '行业' AND (t.effective_to IS NULL OR t.effective_to >= CURDATE())
      WHERE c.is_active = 1 AND q.change_pct IS NOT NULL
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY board_key ORDER BY change_pct DESC, stock_code) AS leader_rank
      FROM grouped
    )
    SELECT
      board_key,
      MAX(board_name) AS board_name,
      MAX(trade_date) AS trade_date,
      AVG(change_pct) AS change_pct,
      SUM(change_pct > 0) AS rising_count,
      SUM(change_pct < 0) AS falling_count,
      MAX(CASE WHEN leader_rank = 1 THEN stock_code END) AS leader_code,
      MAX(CASE WHEN leader_rank = 1 THEN company_name END) AS leader_name
    FROM ranked
    GROUP BY board_key
    HAVING board_key = 'watchlist' OR COUNT(*) >= 2
    ORDER BY board_key
  `)

  if (!rows.length) throw new Error('没有可用于计算板块的最新行情，请先执行 pnpm ingest:quotes。')

  const [spaceRows] = await connection.query<SpaceBoardRow[]>(`
    WITH latest_quote AS (
      SELECT q.company_id, q.trade_date, q.change_pct, q.market_cap
      FROM aero_daily_quote q
      INNER JOIN (SELECT company_id, MAX(trade_date) AS trade_date FROM aero_daily_quote GROUP BY company_id) latest
        ON latest.company_id=q.company_id AND latest.trade_date=q.trade_date
      WHERE q.change_pct IS NOT NULL
    ), business AS (
      SELECT b.company_id, b.sector_id, b.business_role, q.trade_date, q.change_pct, COALESCE(q.market_cap, 0) AS market_cap,
        COALESCE(b.company_revenue_exact, (b.company_revenue_min + b.company_revenue_max) / 2, b.company_revenue_min, b.company_revenue_max,
          CASE b.business_role WHEN '核心业务' THEN 70 WHEN '重要业务' THEN 40 WHEN '相关业务' THEN 15 ELSE 5 END) / 100 AS exposure
      FROM aero_company_space_business b INNER JOIN latest_quote q ON q.company_id=b.company_id
      WHERE b.is_current=1
    ), members AS (
      SELECT sector_id, company_id, trade_date, change_pct, market_cap, exposure FROM business
      UNION ALL
      SELECT s.parent_id AS sector_id, b.company_id, b.trade_date, b.change_pct, b.market_cap, b.exposure
      FROM business b INNER JOIN aero_space_sector s ON s.id=b.sector_id WHERE s.parent_id IS NOT NULL
    ), ranked AS (
      SELECT *, change_pct * market_cap * exposure AS contribution,
        ROW_NUMBER() OVER (PARTITION BY sector_id ORDER BY change_pct DESC, company_id) AS leader_rank,
        ROW_NUMBER() OVER (PARTITION BY sector_id ORDER BY change_pct ASC, company_id) AS laggard_rank,
        ROW_NUMBER() OVER (PARTITION BY sector_id ORDER BY change_pct * market_cap * exposure DESC, company_id) AS contributor_rank
      FROM members
    ), aggregates AS (
      SELECT sector_id, MAX(trade_date) AS trade_date, AVG(change_pct) AS equal_change_pct,
        CASE WHEN SUM(market_cap * exposure) > 0 THEN SUM(change_pct * market_cap * exposure) / SUM(market_cap * exposure) ELSE NULL END AS weighted_change_pct,
        SUM(change_pct > 0) AS rising_count, SUM(change_pct < 0) AS falling_count, SUM(change_pct = 0) AS flat_count,
        SUM(exposure >= .3) AS high_exposure_count, SUM(ABS(contribution)) AS total_abs_contribution, MAX(ABS(contribution)) AS max_abs_contribution,
        MAX(CASE WHEN leader_rank=1 THEN company_id END) AS leader_company_id, MAX(CASE WHEN laggard_rank=1 THEN company_id END) AS laggard_company_id,
        MAX(CASE WHEN contributor_rank=1 THEN company_id END) AS top_contributor_company_id
      FROM ranked GROUP BY sector_id HAVING COUNT(*) >= 1
    )
    SELECT sector_id, trade_date, equal_change_pct, weighted_change_pct, rising_count, falling_count, flat_count, high_exposure_count,
      leader_company_id, laggard_company_id, top_contributor_company_id,
      CASE WHEN total_abs_contribution=0 THEN '待确认' WHEN max_abs_contribution / total_abs_contribution >= .5 THEN '集中' ELSE '均衡' END AS concentration_state
    FROM aggregates
  `)

  await connection.beginTransaction()
  await connection.execute("DELETE FROM aero_board_quote WHERE board_type = '公司池聚合' AND board_key LIKE 'relation-%'")
  for (const row of rows) {
    await connection.execute(
      `INSERT INTO aero_board_quote
        (board_key, board_name, board_type, trade_date, change_pct, rising_count, falling_count, leader_code, leader_name, source_name)
       VALUES (?, ?, '公司池聚合', ?, ?, ?, ?, ?, ?, '本地公司池等权计算')
       ON DUPLICATE KEY UPDATE
         board_name=VALUES(board_name), board_type=VALUES(board_type), change_pct=VALUES(change_pct),
         rising_count=VALUES(rising_count), falling_count=VALUES(falling_count), leader_code=VALUES(leader_code),
         leader_name=VALUES(leader_name), source_name=VALUES(source_name), fetched_at=CURRENT_TIMESTAMP`,
      [row.board_key, row.board_name, row.trade_date, row.change_pct, row.rising_count, row.falling_count, row.leader_code, row.leader_name],
    )
  }
  for (const row of spaceRows) {
    await connection.execute(
      `INSERT INTO aero_space_sector_daily (sector_id, trade_date, equal_change_pct, weighted_change_pct, rising_count, falling_count, flat_count, high_exposure_count, leader_company_id, laggard_company_id, top_contributor_company_id, concentration_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE equal_change_pct=VALUES(equal_change_pct), weighted_change_pct=VALUES(weighted_change_pct), rising_count=VALUES(rising_count), falling_count=VALUES(falling_count), flat_count=VALUES(flat_count), high_exposure_count=VALUES(high_exposure_count), leader_company_id=VALUES(leader_company_id), laggard_company_id=VALUES(laggard_company_id), top_contributor_company_id=VALUES(top_contributor_company_id), concentration_state=VALUES(concentration_state), calculated_at=CURRENT_TIMESTAMP`,
      [row.sector_id, row.trade_date, row.equal_change_pct, row.weighted_change_pct, row.rising_count, row.falling_count, row.flat_count, row.high_exposure_count, row.leader_company_id, row.laggard_company_id, row.top_contributor_company_id, row.concentration_state],
    )
  }
  await connection.commit()
  console.log(`已写入 ${rows.length} 条公司池板块数据与 ${spaceRows.length} 条商业航天细分板块数据：${rows.map((row) => row.board_name).join('、')}`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
