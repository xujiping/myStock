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
}

export type Board = { name: string; change: number; breadth: string; leader: string }
export type Macro = { label: string; value: string; change: string; tone: 'up' | 'down' | 'flat' }

export type OverviewData = {
  asOf: string
  coverage: string
  companies: Company[]
  events: EventItem[]
  boards: Board[]
  macro: Macro[]
  observations: { index: string; title: string; body: string; tone: string }[]
}
