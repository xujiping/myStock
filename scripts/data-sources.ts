import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export type DataSourceDefinition = {
  key: string
  name: string
  type: 'api' | 'agent' | 'search' | 'internal'
  accessMode: 'pull' | 'push' | 'hybrid'
  trustLevel: 'high' | 'medium' | 'low'
  status: 'active' | 'planned'
  description: string
  config: Record<string, unknown>
  capabilities: { key: string, name: string, outputContract: 'raw_data' | 'research_bundle' | 'derived_data', priority: number }[]
}

export const dataSourceCatalog: DataSourceDefinition[] = [
  {
    key: 'akshare', name: 'AKShare', type: 'api', accessMode: 'pull', trustLevel: 'medium', status: 'active',
    description: 'A 股行情、概念归属和公告采集的聚合接口；上游变更时需按能力独立降级。', config: { upstreams: ['腾讯', '东方财富'] },
    capabilities: [
      { key: 'market_quote', name: '行情与估值', outputContract: 'raw_data', priority: 20 },
      { key: 'announcement', name: '公司公告', outputContract: 'raw_data', priority: 30 },
      { key: 'concept_membership', name: '概念归属', outputContract: 'raw_data', priority: 30 },
      { key: 'industry_classification', name: '行业归属', outputContract: 'raw_data', priority: 40 },
      { key: 'macro_indicator', name: '宏观指标', outputContract: 'raw_data', priority: 40 },
    ],
  },
  {
    key: 'baostock', name: 'BaoStock', type: 'api', accessMode: 'pull', trustLevel: 'medium', status: 'active',
    description: '稳定的日线、估值、行业及季频财务补充源。', config: {},
    capabilities: [
      { key: 'market_quote', name: '行情与估值', outputContract: 'raw_data', priority: 10 },
      { key: 'financial_profit', name: '季频盈利能力', outputContract: 'raw_data', priority: 10 },
      { key: 'industry_classification', name: '行业归属', outputContract: 'raw_data', priority: 10 },
    ],
  },
  {
    key: 'hermes_research_agent', name: 'Hermes 研究智能体', type: 'agent', accessMode: 'push', trustLevel: 'medium', status: 'active',
    description: '以标准研究包提交商业航天取证候选；原始公告和网页链接保留为证据来源。', config: { intake: 'data/research/space-exposure' },
    capabilities: [{ key: 'business_exposure_evidence', name: '商业航天业务暴露取证', outputContract: 'research_bundle', priority: 10 }],
  },
  {
    key: 'local_data_pipeline', name: '本地数据处理管线', type: 'internal', accessMode: 'pull', trustLevel: 'high', status: 'active',
    description: '对已入库数据执行规则抽取、板块聚合和日报生成；不直接产生外部事实。', config: { executor: 'local' },
    capabilities: [
      { key: 'event_extraction', name: '公告事件抽取', outputContract: 'derived_data', priority: 10 },
      { key: 'board_aggregation', name: '板块聚合', outputContract: 'derived_data', priority: 10 },
      { key: 'daily_report', name: '盘后日报', outputContract: 'derived_data', priority: 10 },
    ],
  },
  {
    key: 'web_research_connector', name: '网页检索连接器', type: 'search', accessMode: 'hybrid', trustLevel: 'low', status: 'planned',
    description: '供未来搜索、爬取或其他智能体接入；必须输出同一研究包并由证据校验器降噪。', config: {},
    capabilities: [{ key: 'business_exposure_evidence', name: '商业航天业务暴露取证', outputContract: 'research_bundle', priority: 80 }],
  },
]

export async function ensureDataSource(connection: Connection, sourceKey: string) {
  const source = dataSourceCatalog.find((item) => item.key === sourceKey)
  if (!source) throw new Error(`未在数据源目录中定义：${sourceKey}`)
  await connection.execute<ResultSetHeader>(
    `INSERT INTO aero_data_source (source_key, source_name, source_type, access_mode, trust_level, status, config_json, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE source_name=VALUES(source_name), source_type=VALUES(source_type), access_mode=VALUES(access_mode), trust_level=VALUES(trust_level), status=VALUES(status), config_json=VALUES(config_json), description=VALUES(description)`,
    [source.key, source.name, source.type, source.accessMode, source.trustLevel, source.status, JSON.stringify(source.config), source.description],
  )
  const [sources] = await connection.query<(RowDataPacket & { id: number })[]>('SELECT id FROM aero_data_source WHERE source_key=? LIMIT 1', [source.key])
  const sourceId = Number(sources[0]?.id)
  if (!sourceId) throw new Error(`无法初始化数据源：${source.key}`)
  for (const capability of source.capabilities) {
    await connection.execute(
      `INSERT INTO aero_data_source_capability (source_id, capability_key, capability_name, output_contract, priority)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE capability_name=VALUES(capability_name), output_contract=VALUES(output_contract), priority=VALUES(priority), is_active=1`,
      [sourceId, capability.key, capability.name, capability.outputContract, capability.priority],
    )
  }
  return { ...source, id: sourceId }
}

export async function startDataSourceRun(connection: Connection, input: { sourceId: number, capabilityKey: string, runKey: string, triggerType: string }) {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO aero_data_source_run (source_id, capability_key, run_key, trigger_type, status)
     VALUES (?, ?, ?, ?, 'running')
     ON DUPLICATE KEY UPDATE status='running', started_at=CURRENT_TIMESTAMP, finished_at=NULL, artifacts_found=0, records_proposed=0, records_adopted=0, warning_count=0, error_message=NULL`,
    [input.sourceId, input.capabilityKey, input.runKey, input.triggerType],
  )
  if (result.insertId) return Number(result.insertId)
  const [rows] = await connection.query<(RowDataPacket & { id: number })[]>('SELECT id FROM aero_data_source_run WHERE source_id=? AND run_key=? LIMIT 1', [input.sourceId, input.runKey])
  const runId = Number(rows[0]?.id)
  if (!runId) throw new Error(`无法创建数据源运行记录：${input.runKey}`)
  return runId
}

export async function finishDataSourceRun(connection: Connection, runId: number, input: { status: 'success' | 'failed' | 'partial', artifactsFound: number, recordsProposed: number, recordsAdopted: number, warningCount?: number, errorMessage?: string | null }) {
  await connection.execute(
    `UPDATE aero_data_source_run
     SET status=?, finished_at=CURRENT_TIMESTAMP, artifacts_found=?, records_proposed=?, records_adopted=?, warning_count=?, error_message=?
     WHERE id=?`,
    [input.status, input.artifactsFound, input.recordsProposed, input.recordsAdopted, input.warningCount ?? 0, input.errorMessage ?? null, runId],
  )
}

export async function upsertDataArtifact(connection: Connection, input: { sourceId: number, sourceRunId: number, artifactKey: string, artifactType: string, title?: string | null, sourceUrl?: string | null, publishedAt?: string | null, contentHash?: string | null, metadata?: Record<string, unknown> }) {
  await connection.execute(
    `INSERT INTO aero_data_artifact (source_id, source_run_id, artifact_key, artifact_type, title, source_url, published_at, content_hash, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE source_run_id=VALUES(source_run_id), artifact_type=VALUES(artifact_type), title=VALUES(title), source_url=VALUES(source_url), published_at=VALUES(published_at), content_hash=VALUES(content_hash), metadata_json=VALUES(metadata_json)`,
    [input.sourceId, input.sourceRunId, input.artifactKey, input.artifactType, input.title ?? null, input.sourceUrl ?? null, input.publishedAt ?? null, input.contentHash ?? null, JSON.stringify(input.metadata ?? {})],
  )
  const [rows] = await connection.query<(RowDataPacket & { id: number })[]>('SELECT id FROM aero_data_artifact WHERE source_id=? AND artifact_key=? LIMIT 1', [input.sourceId, input.artifactKey])
  const artifactId = Number(rows[0]?.id)
  if (!artifactId) throw new Error(`无法保存数据源产物：${input.artifactKey}`)
  return artifactId
}

export async function linkDataArtifact(connection: Connection, artifactId: number, entityType: string, entityId: number, relationType = 'evidence') {
  await connection.execute('INSERT IGNORE INTO aero_data_artifact_link (artifact_id, entity_type, entity_id, relation_type) VALUES (?, ?, ?, ?)', [artifactId, entityType, entityId, relationType])
}
