import 'dotenv/config'
import mysql from 'mysql2/promise'

export const dbEnabled = process.env.DB_ENABLED === 'true'
const timezone = process.env.DB_TIMEZONE === 'Asia/Shanghai' ? '+08:00' : process.env.DB_TIMEZONE ?? 'Z'

export const pool = dbEnabled ? mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: process.env.DB_CHARSET ?? 'utf8mb4',
  timezone,
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
  multipleStatements: true,
}) : null
