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
  await connection.commit()
  console.log(`已写入 ${rows.length} 条公司池板块数据：${rows.map((row) => row.board_name).join('、')}`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
