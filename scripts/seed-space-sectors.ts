import 'dotenv/config'
import mysql, { type RowDataPacket } from 'mysql2/promise'

if (process.env.DB_ENABLED !== 'true') throw new Error('请先在 .env 中设置 DB_ENABLED=true。')

const sectors = [
  ['rocket', '火箭制造与发射', ['整箭制造', '火箭发动机', '结构件与整流罩', '发射服务']],
  ['satellite', '卫星制造', ['卫星平台', '卫星载荷', '卫星部组件', '卫星总装与测试']],
  ['communication', '卫星通信', ['卫星通信设备', '卫星通信终端', '卫星互联网', '地面站与网络设备']],
  ['ground', '导航、测控与地面系统', ['北斗导航', '测控设备', '地面接收与处理系统', '航天测试与仿真']],
  ['electronics', '航天电子元器件', ['相控阵芯片', '射频器件', '连接器与线缆', '传感器和控制器件']],
  ['materials', '航天材料与工艺', ['复合材料', '特种金属与功能材料', '精密加工', '表面处理与热控材料']],
  ['energy', '空间能源与光伏', ['空间太阳能电池', '卫星电源系统', '航天能源部件', '与航天配套的光伏设备']],
  ['application', '航天应用与数据服务', ['遥感应用', '卫星数据服务', '气象与测绘应用', '行业解决方案']],
  ['operation', '航天运营与配套服务', ['卫星运营', '发射及测控配套', '维保与技术服务', '其他航天配套']],
] as const

const connection = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, charset: process.env.DB_CHARSET ?? 'utf8mb4',
})

try {
  await connection.beginTransaction()
  let count = 0
  for (const [code, name, children] of sectors) {
    await connection.execute('INSERT INTO aero_space_sector (sector_code, sector_name, sector_level, sort_order) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE sector_name=VALUES(sector_name), sector_level=1, sort_order=VALUES(sort_order), is_active=1', [code, name, count + 1])
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM aero_space_sector WHERE sector_code=? LIMIT 1', [code])
    const parentId = rows[0]?.id
    if (!parentId) throw new Error(`无法创建一级板块：${name}`)
    for (const [childIndex, child] of children.entries()) {
      await connection.execute('INSERT INTO aero_space_sector (sector_code, sector_name, parent_id, sector_level, sort_order) VALUES (?, ?, ?, 2, ?) ON DUPLICATE KEY UPDATE sector_name=VALUES(sector_name), parent_id=VALUES(parent_id), sector_level=2, sort_order=VALUES(sort_order), is_active=1', [`${code}-${String(childIndex + 1).padStart(2, '0')}`, child, parentId, childIndex + 1])
      count += 1
    }
  }
  await connection.commit()
  console.log(`商业航天板块字典已就绪：${sectors.length} 个一级板块，${count} 个二级板块。`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
