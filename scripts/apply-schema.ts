import 'dotenv/config'
import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'

const sql = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8')
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
  multipleStatements: true,
})
await connection.query(sql)
await connection.end()
console.log('aero_ schema applied')
