import 'dotenv/config'
import { access, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { ensureDataSource, finishDataSourceRun, linkDataArtifact, startDataSourceRun, upsertDataArtifact } from './data-sources'

const workspace = process.cwd()
const root = path.join(workspace, 'data', 'research', 'space-exposure')
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const apply = args.includes('--apply')
const dateIndex = args.indexOf('--date')
const date = dateIndex >= 0 ? args[dateIndex + 1] : new Date().toISOString().slice(0, 10)

if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('日期格式应为 YYYY-MM-DD。')
if (dateIndex >= 0 && !date) throw new Error('--date 需要一个 YYYY-MM-DD 参数。')

const inboxPath = path.join(root, 'inbox', `${date}.json`)
const evidenceDir = path.join(root, 'evidence', date)
const processedPath = path.join(root, 'processed', `${date}.json`)
const roles = new Set(['核心业务', '重要业务', '相关业务', '概念关联'])
const states = new Set(['明确披露', '公开资料推算', '研究估计', '待确认'])
const confidences = new Set(['高', '中', '低'])
const operations = new Set(['new_evidence', 'update_business', 'update_revenue_exposure', 'watchlist'])

type Evidence = {
  evidenceId: string
  code: string
  companyName: string
  sourceName: string
  sourceUrl?: string | null
  publishedAt?: string | null
  title: string
  excerpt?: string | null
  sourceLevel: string
}

type Candidate = {
  code: string
  companyName: string
  operation: string
  primarySector?: string | null
  secondarySector?: string | null
  businessRole?: string | null
  commercialRevenueExact?: number | null
  commercialRevenueMin?: number | null
  commercialRevenueMax?: number | null
  companyTotalRevenue?: number | null
  contractAmount?: number | null
  contractExposure?: number | string | null
  contractExposureNote?: string | null
  dataState: string
  confidence: string
  calculation?: string | null
  conclusion: string
  evidenceIds: string[]
  recommendation: string
}

type Inbox = { date: string, records: Candidate[] }
type CompanyRow = RowDataPacket & { id: number, company_name: string }
type SectorRow = RowDataPacket & { id: number }
type ProfileRow = RowDataPacket & {
  commercial_revenue_exact: number | null
  commercial_revenue_min: number | null
  commercial_revenue_max: number | null
  commercial_revenue_state: string
  commercial_revenue_confidence: string
  is_manual_confirmed: number
}
type BusinessRow = RowDataPacket & { id: number, business_role: string, data_state: string, confidence: string }

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function loadEvidence(): Promise<Map<string, Evidence>> {
  await access(evidenceDir)
  const files = (await readdir(evidenceDir)).filter((file) => file.endsWith('.json'))
  const evidence = new Map<string, Evidence>()
  for (const file of files) {
    const item = await readJson<Evidence>(path.join(evidenceDir, file))
    if (!item.evidenceId || !item.sourceName || !item.title || !item.sourceLevel || !/^\d{6}$/.test(item.code ?? '')) {
      throw new Error(`证据文件字段不完整：${file}`)
    }
    if (evidence.has(item.evidenceId)) throw new Error(`发现重复证据 ID：${item.evidenceId}`)
    evidence.set(item.evidenceId, item)
  }
  return evidence
}

function isPercent(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
}

function validate(inbox: Inbox, evidence: Map<string, Evidence>) {
  if (inbox.date !== date || !Array.isArray(inbox.records)) throw new Error(`候选文件日期或 records 格式不正确：${inboxPath}`)
  for (const [index, record] of inbox.records.entries()) {
    const prefix = `第 ${index + 1} 条候选`
    if (!/^\d{6}$/.test(record.code ?? '') || !record.companyName || !operations.has(record.operation)) throw new Error(`${prefix} 的公司或 operation 不合法。`)
    if (!states.has(record.dataState) || !confidences.has(record.confidence) || !record.conclusion) throw new Error(`${prefix} 的状态、置信度或结论不合法。`)
    if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length === 0) throw new Error(`${prefix} 必须关联至少一条证据。`)
    if (![record.commercialRevenueExact, record.commercialRevenueMin, record.commercialRevenueMax].every(isPercent)) throw new Error(`${prefix} 的收入暴露比例必须介于 0 和 100。`)
    if (record.contractExposure != null && typeof record.contractExposure !== 'string' && !isPercent(record.contractExposure)) throw new Error(`${prefix} 的订单暴露必须为 0–100 的数值，或写入文字说明。`)
    if (record.commercialRevenueMin != null && record.commercialRevenueMax != null && record.commercialRevenueMin > record.commercialRevenueMax) throw new Error(`${prefix} 的收入区间无效。`)
    if (record.recommendation === '可入库' && record.evidenceIds.some((id) => !evidence.has(id))) throw new Error(`${prefix} 找不到关联的原始证据。`)
    if (record.businessRole && !roles.has(record.businessRole)) throw new Error(`${prefix} 的业务角色不合法。`)
    if (record.operation === 'update_revenue_exposure' && record.commercialRevenueExact == null && record.commercialRevenueMin == null && record.commercialRevenueMax == null) throw new Error(`${prefix} 更新收入暴露时必须提供收入比例。`)
  }
}

function percentFields(record: Candidate) {
  return [record.commercialRevenueExact ?? null, record.commercialRevenueMin ?? null, record.commercialRevenueMax ?? null]
}

async function main() {
  try {
    await access(inboxPath)
  } catch {
    console.log(`未发现待导入候选文件：${inboxPath}`)
    console.log('请先让 Hermes 写入当日 inbox 和 evidence 文件，再执行本命令。')
    return
  }
  const inbox = await readJson<Inbox>(inboxPath)
  const evidence = await loadEvidence()
  validate(inbox, evidence)
  const evidenceRecords = inbox.records.filter((record) => record.recommendation === '可入库' || record.recommendation === '仅保存证据')
  const candidates = inbox.records.filter((record) => record.recommendation === '可入库')
  console.log(`已通过格式校验：${inbox.records.length} 条候选，其中 ${candidates.length} 条可入库、${evidenceRecords.length - candidates.length} 条仅保存证据。${apply ? '' : '（预检模式，未写入数据库）'}`)
  if (!apply) return
  if (process.env.DB_ENABLED !== 'true') throw new Error('请先在 .env 中设置 DB_ENABLED=true。')

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: process.env.DB_CHARSET ?? 'utf8mb4',
  })
  let imported = 0
  let profileUpdates = 0
  let evidenceOnlySaved = 0
  let sourceRunId = 0
  let committed = false
  const importedArtifactKeys = new Set<string>()
  try {
    const source = await ensureDataSource(connection, 'hermes_research_agent')
    sourceRunId = await startDataSourceRun(connection, { sourceId: source.id, capabilityKey: 'business_exposure_evidence', runKey: `space-exposure-${date}`, triggerType: 'agent_push' })
    await connection.beginTransaction()
    const artifactIds = new Map<string, number>()
    for (const item of evidence.values()) {
      const artifactId = await upsertDataArtifact(connection, {
        sourceId: source.id,
        sourceRunId,
        artifactKey: item.evidenceId,
        artifactType: 'research_evidence',
        title: item.title,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        contentHash: item.evidenceId,
        metadata: { collector: 'hermes_research_agent', originSource: item.sourceName, sourceLevel: item.sourceLevel, companyCode: item.code },
      })
      artifactIds.set(item.evidenceId, artifactId)
      importedArtifactKeys.add(item.evidenceId)
    }
    for (const record of evidenceRecords) {
      const [companies] = await connection.query<CompanyRow[]>('SELECT id, company_name FROM aero_company WHERE stock_code=? AND is_active=1 LIMIT 1', [record.code])
      const company = companies[0]
      if (!company) throw new Error(`${record.code} 不在已入库的有效公司池中。`)
      const recordEvidence = record.evidenceIds.map((id) => evidence.get(id)!).filter(Boolean)
      if (recordEvidence.some((item) => item.code !== record.code)) throw new Error(`${record.code} 的候选关联了其他公司的证据。`)

      for (const item of recordEvidence) {
        await connection.execute(
          `INSERT INTO aero_company_space_profile_evidence (company_id, evidence_key, evidence_title, source_name, source_url, published_at, source_level, excerpt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE evidence_title=VALUES(evidence_title), source_name=VALUES(source_name), source_url=VALUES(source_url), published_at=VALUES(published_at), source_level=VALUES(source_level), excerpt=VALUES(excerpt)`,
          [company.id, item.evidenceId, item.title, item.sourceName, item.sourceUrl ?? null, item.publishedAt ?? null, item.sourceLevel, item.excerpt ?? null],
        )
        const [profileEvidenceRows] = await connection.query<RowDataPacket[]>('SELECT id FROM aero_company_space_profile_evidence WHERE company_id=? AND evidence_key=? LIMIT 1', [company.id, item.evidenceId])
        const profileEvidenceId = Number(profileEvidenceRows[0]?.id)
        if (!profileEvidenceId) throw new Error(`无法关联公司画像证据：${item.evidenceId}`)
        const artifactId = artifactIds.get(item.evidenceId)
        if (!artifactId) throw new Error(`无法关联数据源产物：${item.evidenceId}`)
        await linkDataArtifact(connection, artifactId, '公司画像证据', profileEvidenceId)
      }

      if (record.recommendation !== '可入库') {
        evidenceOnlySaved += 1
        continue
      }

      let businessId: number | null = null
      if (record.secondarySector) {
        const [sectors] = await connection.query<SectorRow[]>('SELECT id FROM aero_space_sector WHERE sector_name=? AND sector_level=2 AND is_active=1 LIMIT 1', [record.secondarySector])
        const sector = sectors[0]
        if (!sector) throw new Error(`${record.code} 的二级板块不存在：${record.secondarySector}`)
        const [businesses] = await connection.query<BusinessRow[]>('SELECT id, business_role, data_state, confidence FROM aero_company_space_business WHERE company_id=? AND sector_id=? AND is_current=1 ORDER BY id LIMIT 1', [company.id, sector.id])
        const existing = businesses[0]
        if (!existing) {
          const [result] = await connection.execute<mysql.ResultSetHeader>(
            `INSERT INTO aero_company_space_business (company_id, sector_id, business_role, data_state, confidence, source_name, source_url, source_date, research_note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [company.id, sector.id, record.businessRole ?? '相关业务', record.dataState, record.confidence, recordEvidence[0].sourceName, recordEvidence[0].sourceUrl ?? null, recordEvidence[0].publishedAt ?? null, record.conclusion],
          )
          businessId = result.insertId
        } else {
          businessId = existing.id
          if (record.operation === 'update_business') {
            const before = { role: existing.business_role, dataState: existing.data_state, confidence: existing.confidence }
            const after = { role: record.businessRole ?? existing.business_role, dataState: record.dataState, confidence: record.confidence }
            await connection.execute('UPDATE aero_company_space_business SET business_role=?, data_state=?, confidence=?, source_name=?, source_url=?, source_date=?, research_note=? WHERE id=?', [after.role, after.dataState, after.confidence, recordEvidence[0].sourceName, recordEvidence[0].sourceUrl ?? null, recordEvidence[0].publishedAt ?? null, record.conclusion, businessId])
            await connection.execute('INSERT INTO aero_space_profile_revision (company_id, entity_type, entity_id, action_type, before_value, after_value, change_reason, operator_name, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)', [company.id, '商业航天业务', businessId, '自动更新', JSON.stringify(before), JSON.stringify(after), record.conclusion, 'hermes-importer'])
          }
        }
      }

      if (businessId) {
        for (const item of recordEvidence) {
          const [existingEvidence] = await connection.query<RowDataPacket[]>('SELECT id FROM aero_space_business_evidence WHERE business_id=? AND evidence_title=? AND source_url <=> ? LIMIT 1', [businessId, item.title, item.sourceUrl ?? null])
          if (!existingEvidence[0]) await connection.execute('INSERT INTO aero_space_business_evidence (business_id, evidence_title, source_name, source_url, published_at, data_state, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?)', [businessId, item.title, item.sourceName, item.sourceUrl ?? null, item.publishedAt ?? null, record.dataState, item.excerpt ?? null])
        }
      }

      if (record.operation === 'update_revenue_exposure') {
        const [profiles] = await connection.query<ProfileRow[]>('SELECT commercial_revenue_exact, commercial_revenue_min, commercial_revenue_max, commercial_revenue_state, commercial_revenue_confidence, is_manual_confirmed FROM aero_company_space_profile WHERE company_id=? LIMIT 1', [company.id])
        const old = profiles[0]
        if (old?.is_manual_confirmed) {
          console.log(`${record.code} 的画像已人工确认：已保存证据，跳过自动收入更新。`)
        } else {
          const [exact, min, max] = percentFields(record)
          await connection.execute(
            `INSERT INTO aero_company_space_profile (company_id, commercial_revenue_exact, commercial_revenue_min, commercial_revenue_max, commercial_revenue_state, commercial_revenue_confidence, source_name, source_url, source_date, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hermes-importer')
             ON DUPLICATE KEY UPDATE commercial_revenue_exact=VALUES(commercial_revenue_exact), commercial_revenue_min=VALUES(commercial_revenue_min), commercial_revenue_max=VALUES(commercial_revenue_max), commercial_revenue_state=VALUES(commercial_revenue_state), commercial_revenue_confidence=VALUES(commercial_revenue_confidence), source_name=VALUES(source_name), source_url=VALUES(source_url), source_date=VALUES(source_date), updated_by='hermes-importer'`,
            [company.id, exact, min, max, record.dataState, record.confidence, recordEvidence[0].sourceName, recordEvidence[0].sourceUrl ?? null, recordEvidence[0].publishedAt ?? null],
          )
          await connection.execute('INSERT INTO aero_space_profile_revision (company_id, entity_type, action_type, field_name, before_value, after_value, change_reason, operator_name, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)', [company.id, '公司画像', '自动更新', '商业航天收入暴露', old ? JSON.stringify(old) : null, JSON.stringify({ exact, min, max, dataState: record.dataState, confidence: record.confidence }), `${record.conclusion}${record.calculation ? `；计算：${record.calculation}` : ''}`, 'hermes-importer'])
          profileUpdates += 1
        }
      }
      imported += 1
    }
    await connection.commit()
    committed = true
    await mkdir(path.dirname(processedPath), { recursive: true })
    await rename(inboxPath, processedPath)
    await finishDataSourceRun(connection, sourceRunId, { status: 'success', artifactsFound: evidence.size, recordsProposed: inbox.records.length, recordsAdopted: imported })
  } catch (error) {
    if (!committed) await connection.rollback()
    if (sourceRunId) await finishDataSourceRun(connection, sourceRunId, {
      status: 'failed', artifactsFound: evidence.size, recordsProposed: inbox.records.length, recordsAdopted: imported,
      errorMessage: error instanceof Error ? error.message : '未知导入错误',
    })
    throw error
  } finally {
    await connection.end()
  }

  console.log(`已导入 ${imported} 条候选、保存 ${evidenceOnlySaved} 条仅证据记录、登记 ${importedArtifactKeys.size} 条原始产物、更新 ${profileUpdates} 条收入暴露；候选文件已移至 ${processedPath}`)
}

await main()
