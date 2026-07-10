import 'dotenv/config'
import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'

const filePath = process.argv.slice(2).find((argument) => argument !== '--') ?? 'data/company-pool.txt'
const content = await fs.readFile(filePath, 'utf8')
const rawLines = content.split(/\r?\n/).map((line) => line.trim())
let inAShareSection = false
const lines = rawLines.filter((line) => {
  if (line.includes('一、中国 A 股上市公司')) inAShareSection = true
  if (line.includes('二、中国未上市民营商业航天公司')) inAShareSection = false
  return line && !line.startsWith('#') && (line.includes('|') || inAShareSection)
})
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
})

await connection.beginTransaction()
let imported = 0
for (const line of lines) {
  let stockCode = ''
  let companyName = ''
  let relatedLevel = '待确认'
  let industry = ''
  let concepts = ''
  if (line.includes('|')) {
    const cells = line.split('|').map((item) => item.trim())
    ;[stockCode, companyName, relatedLevel = '待确认', industry = '', concepts = ''] = cells
  } else {
    const match = line.match(/^(.+?)\s+(\d{6})$/)
    if (!match) continue
    companyName = match[1].trim()
    stockCode = match[2]
  }
  if (!/^\d{6}$/.test(stockCode) || !companyName) continue
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO aero_company (stock_code, company_name, related_level)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), related_level = VALUES(related_level), updated_at = CURRENT_TIMESTAMP`,
    [stockCode, companyName, relatedLevel],
  )
  const companyId = result.insertId || Number((await connection.query('SELECT id FROM aero_company WHERE stock_code = ?', [stockCode]) as any)[0][0].id)
  const tags = [industry ? ['行业', industry] : null, ...concepts.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => ['概念', tag])].filter(Boolean) as string[][]
  for (const [tagType, tagName] of tags) await connection.execute('INSERT IGNORE INTO aero_company_tag (company_id, tag_type, tag_name, source_name) VALUES (?, ?, ?, ?)', [companyId, tagType, tagName, 'company-pool.txt'])
  imported += 1
}
await connection.commit()
await connection.end()
console.log(`imported ${imported} companies from ${filePath}`)
