export type Page = 'overview' | 'companies' | 'events' | 'reports' | 'sync'

export type Company = {
  code: string
  name: string
  level: string
  industry: string
  concept: string
  price: string
  change: number
  marketCap: string
  signal: string
  signalTone: 'positive' | 'negative' | 'neutral'
  tags: string[]
  spark: number[]
  spaceProfile?: CompanySpaceProfile
}

export type EventItem = {
  id: string
  time: string
  company: string
  code: string
  type: string
  title: string
  detail: string
  level: '高' | '中' | '低'
  status?: string
  sourceUrl?: string | null
}

export type Board = {
  name: string
  change: number
  breadth: string
  leader: string
  boardType?: '一级板块' | '二级板块' | '主题'
  fallingCount?: number
  flatCount?: number
  weightedChange?: number | null
  exposure?: string
  contributor?: string
  concentration?: '集中' | '均衡' | '待确认'
}
export type Macro = { label: string; value: string; change: string; tone: 'up' | 'down' | 'flat' }

export type Confidence = '高' | '中' | '低'
export type DataState = '明确披露' | '公开资料推算' | '研究估计' | '待确认' | '无法确认'
export type BusinessRole = '核心业务' | '重要业务' | '相关业务' | '概念关联'

export type SpaceBusiness = {
  id: string
  primarySector: string
  secondarySector: string
  role: BusinessRole
  revenueShare: string
  companyRevenueShare: string
  status: string
  confidence: Confidence
  dataState: DataState
  chainValue: string
  chainImportance: number | null
  companyImportance: number | null
  source: string
  sourceUrl?: string | null
  sourceDate?: string | null
  note?: string
}

export type EvidenceItem = {
  id: string
  title: string
  source: string
  sourceUrl?: string | null
  publishedAt?: string | null
  dataState: DataState
  excerpt: string
}

export type RevisionItem = {
  id: string
  entityType: string
  action: string
  fieldName?: string | null
  beforeValue?: string | null
  afterValue?: string | null
  reason?: string | null
  operatorName: string
  isManual: boolean
  createdAt: string
}

export type CompanySpaceProfile = {
  commercialRevenueShare: string
  commercialRevenueState: DataState
  commercialRevenueConfidence: Confidence
  nonSpaceCoreBusinesses: string[]
  businessSummary: string
  updatedAt: string
  businesses: SpaceBusiness[]
  evidences?: EvidenceItem[]
  revisions?: RevisionItem[]
}

export type OverviewData = {
  asOf: string
  coverage: string
  companies: Company[]
  events: EventItem[]
  boards: Board[]
  macro: Macro[]
  observations: { index: string; title: string; body: string; tone: string }[]
}
