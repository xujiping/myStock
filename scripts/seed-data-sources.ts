import 'dotenv/config'
import mysql from 'mysql2/promise'
import { dataSourceCatalog, ensureDataSource } from './data-sources'

if (process.env.DB_ENABLED !== 'true') throw new Error('请先在 .env 中设置 DB_ENABLED=true。')

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
})

try {
  await connection.beginTransaction()
  for (const source of dataSourceCatalog) await ensureDataSource(connection, source.key)
  await connection.commit()
  console.log(`数据源目录已就绪：${dataSourceCatalog.map((source) => source.name).join('、')}。`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
