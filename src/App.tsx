import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  CircleCheck,
  Clock3,
  Database,
  FileDown,
  FileText,
  Filter,
  LayoutDashboard,
  ListChecks,
  ListFilter,
  Layers3,
  Gauge,
  History,
  Moon,
  RefreshCw,
  Play,
  Search,
  Settings2,
  ShieldAlert,
  Sun,
  Telescope,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react'
import { overviewData } from './data/mock'
import type { Company, CompanySpaceProfile, EventItem, OverviewData, Page } from './types'

type IngestionStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed'
type IngestionState = {
  status: IngestionStatus
  startedAt?: string
  finishedAt?: string
  recordsWritten: number
  warningCount: number
  message?: string
}

type SyncTaskStatus = IngestionStatus
type SyncTask = {
  key: 'quotes' | 'announcements' | 'events' | 'industry' | 'concepts' | 'finance' | 'boards'
  label: string
  description: string
  cadence: string
  status: SyncTaskStatus
  running: boolean
  syncRunId?: number
  startedAt?: string
  finishedAt?: string
  recordsWritten: number
  warningCount: number
  retryAt?: string
  errorMessage?: string
  retryEnabled: boolean
  retryAttempt: number
}
type SyncLog = { id: number; level: 'info' | 'warn' | 'error'; message: string; createdAt?: string }
type DailySyncState = {
  enabled: boolean
  time: string
  timeZone: string
  tasks: SyncTask['key'][]
  status: IngestionStatus
  running: boolean
  trigger?: 'scheduled' | 'manual'
  startedAt?: string
  finishedAt?: string
  currentTask?: SyncTask['key']
  retryAt?: string
  errorMessage?: string
}
type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'aero-investment-theme'

type CompanyDetail = {
  company: { code: string; name: string; exchange?: string | null; level: string; description?: string | null; latestQuote: { tradeDate: string; open: string; high: string; low: string; close: string; change: number | null; volume: number | null; turnover: number | null; turnoverRate: number | null; marketCap: string; peTtm: string; pb: string; source?: string | null } | null }
  tags: { type: string; name: string }[]
  quotes: { date: string; open: number; high: number; low: number; close: number; change: number | null; volume: number | null; turnover: number | null; turnoverRate: number | null }[]
  events: { id: number; type: string; status?: string | null; level: '高' | '中' | '低'; title: string; detail?: string | null; announcedAt: string }[]
  facts: { type: string; title: string; content: string; state: string; disclosedAt?: string | null; source?: string | null; sourceUrl?: string | null }[]
  profile?: CompanySpaceProfile | null
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: '今日总览', icon: LayoutDashboard },
  { id: 'companies', label: '公司池', icon: Telescope },
  { id: 'events', label: '事件中心', icon: BellRing },
  { id: 'sync', label: '数据同步', icon: ListChecks },
  { id: 'reports', label: '日报归档', icon: FileText },
]

function formatChange(change: number) {
  return `${change > 0 ? '+' : ''}${change.toFixed(2)}%`
}

function ToneValue({ value, tone }: { value: string; tone: 'up' | 'down' | 'flat' | 'positive' | 'negative' | 'neutral' }) {
  const className = tone === 'up' || tone === 'positive' ? 'value-up' : tone === 'down' || tone === 'negative' ? 'value-down' : 'value-flat'
  return <span className={className}>{value}</span>
}

function Spark({ points, tone }: { points: number[]; tone: Company['signalTone'] }) {
  const max = Math.max(...points)
  const min = Math.min(...points)
  return (
    <div className={`spark spark-${tone}`} aria-label="近期趋势">
      {points.map((point, index) => (
        <i key={`${point}-${index}`} style={{ height: `${Math.max(22, ((point - min) / Math.max(1, max - min)) * 68 + 20)}%` }} />
      ))}
    </div>
  )
}

function ChangeBadge({ change }: { change: number }) {
  const up = change >= 0
  return <span className={`change-badge ${up ? 'up' : 'down'}`}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{formatChange(change)}</span>
}

function App() {
  const [activePage, setActivePage] = useState<Page>('overview')
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'dark' ? 'dark' : 'light'
  })
  const [data, setData] = useState<OverviewData>(overviewData)
  const [dataMode, setDataMode] = useState<'demo' | 'mysql'>('demo')
  const [dataError, setDataError] = useState('')
  const [query, setQuery] = useState('')
  const [eventLevel, setEventLevel] = useState<'全部' | EventItem['level']>('全部')
  const [refreshedAt, setRefreshedAt] = useState('18:42')
  const [ingestion, setIngestion] = useState<IngestionState>({ status: 'idle', recordsWritten: 0, warningCount: 0 })
  const [syncTasks, setSyncTasks] = useState<SyncTask[]>([])
  const [selectedSyncTask, setSelectedSyncTask] = useState<SyncTask['key']>('quotes')
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [syncError, setSyncError] = useState('')
  const [dailySync, setDailySync] = useState<DailySyncState>({ enabled: true, time: '18:30', timeZone: 'Asia/Shanghai', tasks: ['quotes', 'boards'], status: 'idle', running: false })
  const todayLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .format(new Date())
    .replace(/年|月/g, ' / ')
    .replace('日', ' · ')

  const visibleEvents = useMemo(() => eventLevel === '全部' ? data.events : data.events.filter((event) => event.level === eventLevel), [data.events, eventLevel])

  const loadOverview = async () => {
    try {
      const response = await fetch('/api/overview')
      if (!response.ok) throw new Error('数据服务暂不可用')
      const payload = await response.json() as OverviewData & { dataMode: 'demo' | 'mysql' }
      setData(payload)
      setDataMode(payload.dataMode)
      setDataError('')
      setRefreshedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (error) {
      setDataError(error instanceof Error ? error.message : '数据服务暂不可用')
    }
  }

  const loadIngestionStatus = async (): Promise<IngestionState | null> => {
    try {
      const response = await fetch('/api/ingestion/status')
      if (!response.ok) return null
      const next = await response.json() as IngestionState
      setIngestion(next)
      return next
    } catch {
      // 状态读取失败不阻断页面数据展示。
      return null
    }
  }

  const loadSyncTasks = async () => {
    try {
      const response = await fetch('/api/sync/tasks')
      if (!response.ok) throw new Error('同步中心暂不可用')
      const payload = await response.json() as { items: SyncTask[] }
      setSyncTasks(payload.items)
      setSyncError('')
      const selectedExists = payload.items.some((task) => task.key === selectedSyncTask)
      if (!selectedExists && payload.items[0]) setSelectedSyncTask(payload.items[0].key)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '同步中心暂不可用')
    }
  }

  const loadSyncLogs = async (taskKey = selectedSyncTask) => {
    try {
      const response = await fetch(`/api/sync/tasks/${taskKey}/logs`)
      if (!response.ok) throw new Error('任务日志暂不可用')
      const payload = await response.json() as { items: SyncLog[] }
      setSyncLogs(payload.items)
    } catch {
      setSyncLogs([])
    }
  }

  const loadDailySync = async () => {
    try {
      const response = await fetch('/api/sync/daily')
      if (!response.ok) throw new Error('盘后同步状态暂不可用')
      setDailySync(await response.json() as DailySyncState)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '盘后同步状态暂不可用')
    }
  }

  const triggerSyncTask = async (taskKey: SyncTask['key']) => {
    setSelectedSyncTask(taskKey)
    try {
      const response = await fetch(`/api/sync/tasks/${taskKey}/run`, { method: 'POST' })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? '同步任务启动失败')
      await loadSyncTasks()
      await loadSyncLogs(taskKey)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '同步任务启动失败')
    }
  }

  const triggerDailySync = async () => {
    try {
      const response = await fetch('/api/sync/daily/run', { method: 'POST' })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? '盘后同步启动失败')
      await Promise.all([loadDailySync(), loadSyncTasks()])
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '盘后同步启动失败')
    }
  }

  useEffect(() => {
    void loadOverview()
    void loadIngestionStatus()
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f7f4' : '#101214')
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])
  useEffect(() => {
    if (ingestion.status !== 'running') return
    const timer = window.setInterval(async () => {
      const next = await loadIngestionStatus()
      if (next && next.status !== 'running') void loadOverview()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [ingestion.status])
  useEffect(() => {
    if (activePage !== 'sync') return
    void loadSyncTasks()
    void loadSyncLogs()
    void loadDailySync()
    const timer = window.setInterval(() => { void loadSyncTasks(); void loadSyncLogs(); void loadDailySync() }, 2500)
    return () => window.clearInterval(timer)
  }, [activePage, selectedSyncTask])
  const handleRefresh = () => { void loadOverview() }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand-mark"><span className="brand-orbit" /><span className="brand-copy"><strong>轨道观察</strong><small>A-SHARE / AEROSPACE</small></span></div>
        <div className="sidebar-section-label">研究工作台</div>
        <nav className="main-nav">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage(id)}><Icon size={17} /><span>{label}</span>{id === 'events' && <em>{data.events.length}</em>}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="system-status"><span className="status-dot" /><div><strong>盘后任务就绪</strong><small>上次更新 {refreshedAt}</small></div></div>
        <button className="nav-item muted"><Settings2 size={17} /><span>数据设置</span></button>
        <button className="nav-item muted theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          <span>{theme === 'light' ? '深色主题' : '白色主题'}</span>
        </button>
        <div className="sidebar-foot"><span>数据源</span><span className="source-chip"><Database size={12} /> {dataMode.toUpperCase()}</span></div>
      </aside>

      <main className="main-canvas">
        <header className="topbar"><div className="breadcrumb"><span>研究终端</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === activePage)?.label}</strong></div><div className="top-actions"><SyncStatusPill state={ingestion} onOpen={() => setActivePage('sync')} /><span className="date-stamp"><CalendarDays size={14} /> {todayLabel}</span><button className="icon-button" title="刷新数据" onClick={handleRefresh}><RefreshCw size={16} /></button><button className="avatar" title="账户">XJ</button></div></header>

        <div className="page-wrap">
          {dataError && <div className="data-warning"><AlertTriangle size={15} /> {dataError}，当前保留上一次可用数据。</div>}
          {activePage === 'overview' && <Overview data={data} onNavigate={setActivePage} />}
          {activePage === 'companies' && <Companies companies={data.companies} totalCompanies={data.companies.length} query={query} setQuery={setQuery} />}
          {activePage === 'events' && <Events events={visibleEvents} totalEvents={data.events.length} level={eventLevel} setLevel={setEventLevel} />}
          {activePage === 'sync' && <SyncCenter tasks={syncTasks} selectedTask={selectedSyncTask} setSelectedTask={setSelectedSyncTask} logs={syncLogs} dailySync={dailySync} error={syncError} onRun={triggerSyncTask} onRunDaily={triggerDailySync} onRefresh={() => { void loadSyncTasks(); void loadSyncLogs(); void loadDailySync() }} />}
          {activePage === 'reports' && <Reports />}
        </div>
        <footer className="main-footer"><span><ShieldAlert size={13} /> 研究信息工具，不构成投资建议</span><span>行情数据：盘后批次 · 任务状态：正常</span></footer>
      </main>
    </div>
  )
}

function SyncStatusPill({ state, onOpen }: { state: IngestionState; onOpen: () => void }) {
  const labels: Record<IngestionStatus, string> = { idle: '同步待命', running: '同步中', success: '已同步', partial: '部分成功', failed: '同步失败' }
  return <button className={`sync-status-pill sync-status-${state.status}`} onClick={onOpen} title="打开数据同步中心">
    <span className="sync-status-pulse" />
    <span>{labels[state.status]}</span>
    <small>{state.status === 'running' ? state.message ?? '正在更新数据' : `${state.recordsWritten.toLocaleString('zh-CN')} 条`}</small>
  </button>
}

function Overview({ data, onNavigate }: { data: OverviewData; onNavigate: (page: Page) => void }) {
  const positiveCount = data.companies.filter((company) => company.change > 0).length
  return <>
    <section className="hero-row"><div><div className="eyebrow"><span className="eyebrow-line" />盘后情报 · 主题航天</div><h1>今日值得关注的<br /><span>变化与证据</span></h1><p className="hero-sub">聚焦 {data.coverage}，从行情、事件和宏观背景中筛出真正改变判断的信息。</p></div><div className="hero-meta"><div className="hero-meta-label">今日数据覆盖</div><strong>{data.coverage}</strong><div className="coverage-track"><span style={{ width: '82%' }} /></div><small>{data.asOf}</small></div></section>
    <section className="metric-grid"><Metric label="公司池表现" value={`${data.companies.length ? (data.companies.reduce((sum, company) => sum + company.change, 0) / data.companies.length >= 0 ? '+' : '') : ''}${data.companies.length ? (data.companies.reduce((sum, company) => sum + company.change, 0) / data.companies.length).toFixed(2) : '--'}%`} note={`${positiveCount} 家上涨 / ${data.companies.length - positiveCount} 家下跌`} tone="up" icon={<TrendingUp size={16} />} /><Metric label="重要事件" value={String(data.events.length).padStart(2, '0')} note={`${data.events.filter((event) => event.level === '高').length} 条需要复核`} tone="amber" icon={<BellRing size={16} />} /><Metric label="减持状态" value={String(data.events.filter((event) => event.type === '减持').length).padStart(2, '0')} note="以事件中心最新状态为准" tone="down" icon={<ShieldAlert size={16} />} /><Metric label="数据新鲜度" value={data.asOf.includes('尚未') ? '--' : '已更新'} note={data.asOf} tone="cyan" icon={<Activity size={16} />} /></section>
    <section className="content-grid overview-grid"><div className="panel company-panel"><PanelHeading eyebrow="WATCHLIST / 关注池" title="公司池异动" action="查看全部" onAction={() => onNavigate('companies')} /><div className="table-head company-head"><span>公司</span><span>收盘</span><span>涨跌</span><span>趋势</span><span>信号</span></div>{data.companies.slice(0, 5).map((company) => <CompanyRow key={company.code} company={company} />)}</div><div className="panel board-panel"><PanelHeading eyebrow="SPACE PULSE / 商业航天板块脉搏" title="细分板块表现" action="公司画像" onAction={() => onNavigate('companies')} /><div className="pulse-legend"><span><i className="pulse-up" />等权涨跌</span><span>上涨 / 下跌</span><span>主要贡献</span></div>{data.boards.slice(0, 4).map((board, index) => <div className="board-row space-board-row" key={board.name}><div className="rank">0{index + 1}</div><div className="board-name"><strong>{board.name}<small className="sector-level">{board.boardType ?? '细分板块'}</small></strong><small>{board.breadth} · 领涨 {board.leader}{board.concentration ? ` · ${board.concentration}推动` : ''}</small></div><div className="board-contributor"><small>{board.exposure ?? '暴露度待确认'}</small><span>{board.contributor ? `贡献 ${board.contributor}` : '贡献待确认'}</span></div><ChangeBadge change={board.change} /></div>)}</div></section>
    <section className="content-grid lower-grid"><div className="panel observation-panel"><PanelHeading eyebrow="AI RESEARCH NOTE / 研究摘要" title="今天的三条观察" action="打开日报" onAction={() => onNavigate('reports')} />{data.observations.map((observation) => <div className="observation-row" key={observation.index}><span className={`observation-index ${observation.tone}`}>{observation.index}</span><div><strong>{observation.title}</strong><p>{observation.body}</p></div><ChevronRight size={16} /></div>)}</div><div className="panel macro-panel"><PanelHeading eyebrow="MACRO WEATHER / 宏观天气" title="外部环境" action="" />{data.macro.map((item) => <div className="macro-row" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><ToneValue value={item.change} tone={item.tone} /></div>)}<div className="macro-note"><CircleHelp size={14} /> 缺失数据会以“待补充”或“暂无环比”明确标识。</div></div></section>
  </>
}

function Metric({ label, value, note, tone, icon }: { label: string; value: string; note: string; tone: string; icon: React.ReactNode }) {
  return <div className={`metric metric-${tone}`}><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></div>
}

function PanelHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action: string; onAction?: () => void }) {
  return <div className="panel-heading"><div><div className="panel-eyebrow">{eyebrow}</div><h2>{title}</h2></div>{action && <button className="text-button" onClick={onAction}>{action}<ChevronRight size={14} /></button>}</div>
}

function CompanyRow({ company }: { company: Company }) {
  return <div className="table-row company-row"><div className="company-cell"><span className="stock-code">{company.code}</span><strong>{company.name}</strong><small>{company.concept}</small></div><strong>{company.price}</strong><ToneValue value={formatChange(company.change)} tone={company.change >= 0 ? 'positive' : 'negative'} /><Spark points={company.spark} tone={company.signalTone} /><span className={`signal signal-${company.signalTone}`}>{company.signal}</span></div>
}

function Companies({ companies, totalCompanies, query, setQuery }: { companies: Company[]; totalCompanies: number; query: string; setQuery: (value: string) => void }) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [detail, setDetail] = useState<CompanyDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [loadingCode, setLoadingCode] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [levelMenuOpen, setLevelMenuOpen] = useState(false)
  const [level, setLevel] = useState('全部')
  const [industry, setIndustry] = useState('全部')
  const [performance, setPerformance] = useState<'全部' | '上涨' | '下跌'>('全部')
  const [spaceSector, setSpaceSector] = useState('全部')
  const [businessRole, setBusinessRole] = useState('全部')
  const levels = useMemo(() => ['全部', ...Array.from(new Set(companies.map((company) => company.level))).sort()], [companies])
  const industries = useMemo(() => ['全部', ...Array.from(new Set(companies.map((company) => company.industry))).filter((item) => item !== '待补充').sort()], [companies])
  const spaceSectors = useMemo(() => ['全部', ...Array.from(new Set(companies.flatMap((company) => company.spaceProfile?.businesses.map((business) => business.primarySector) ?? []))).sort()], [companies])
  const businessRoles = useMemo(() => ['全部', ...Array.from(new Set(companies.flatMap((company) => company.spaceProfile?.businesses.map((business) => business.role) ?? [])))], [companies])
  const selectedCompany = useMemo(() => selectedCode ? companies.find((company) => company.code === selectedCode) ?? null : null, [companies, selectedCode])
  const filteredCompanies = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return companies.filter((company) => {
      const matchesKeyword = !keyword || [company.name, company.code, company.industry, company.concept].some((value) => value.toLowerCase().includes(keyword))
      const matchesLevel = level === '全部' || company.level === level
      const matchesIndustry = industry === '全部' || company.industry === industry
      const matchesPerformance = performance === '全部' || (performance === '上涨' ? company.change >= 0 : company.change < 0)
      const matchesSector = spaceSector === '全部' || company.spaceProfile?.businesses.some((business) => business.primarySector === spaceSector)
      const matchesRole = businessRole === '全部' || company.spaceProfile?.businesses.some((business) => business.role === businessRole)
      return matchesKeyword && matchesLevel && matchesIndustry && matchesPerformance && matchesSector && matchesRole
    })
  }, [businessRole, companies, industry, level, performance, query, spaceSector])
  const activeFilterCount = Number(level !== '全部') + Number(industry !== '全部') + Number(performance !== '全部') + Number(spaceSector !== '全部') + Number(businessRole !== '全部')
  const clearFilters = () => { setLevel('全部'); setIndustry('全部'); setPerformance('全部'); setSpaceSector('全部'); setBusinessRole('全部'); setQuery(''); setLevelMenuOpen(false) }
  const closeDetail = () => {
    setSelectedCode(null)
    setDetail(null)
    setDetailError('')
    setLoadingCode(null)
  }
  const openDetail = async (code: string) => {
    if (selectedCode === code) return
    setSelectedCode(code); setDetail(null); setDetailError(''); setLoadingCode(code)
    try {
      const response = await fetch(`/api/companies/${code}`)
      const payload = await response.json() as CompanyDetail & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? '详情数据暂不可用')
      setDetail(payload)
    } catch (error) { setDetailError(error instanceof Error ? error.message : '详情数据暂不可用') }
    finally { setLoadingCode(null) }
  }
  useEffect(() => {
    if (!selectedCode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCode])

  return <><section className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" />公司池 / {totalCompanies} 家</div><h1>航天相关公司</h1><p className="page-sub">按产业链位置、业务角色和商业航天暴露度筛选；点击公司后在右侧抽屉查看可追溯画像。</p></div><button className={`primary-button ${filtersOpen ? 'active-filter-button' : ''}`} onClick={() => setFiltersOpen((open) => !open)}><ListFilter size={15} /> 管理筛选{activeFilterCount > 0 && <em>{activeFilterCount}</em>}</button></section>{filtersOpen && <section className="filter-panel"><div className="filter-panel-top"><div><span>FILTERS / 即时生效</span><strong>公司画像筛选</strong></div><button className="text-button" onClick={clearFilters}>清空条件</button></div><div className="filter-groups"><FilterGroup label="关联等级" value={level} options={levels} onChange={setLevel} /><FilterGroup label="行业标签" value={industry} options={industries} onChange={setIndustry} /><FilterGroup label="最新涨跌" value={performance} options={['全部', '上涨', '下跌']} onChange={(value) => setPerformance(value as typeof performance)} /><FilterGroup label="一级板块" value={spaceSector} options={spaceSectors} onChange={setSpaceSector} /><FilterGroup label="业务角色" value={businessRole} options={businessRoles} onChange={setBusinessRole} /></div></section>}<div className="toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、代码、行业、板块或角色" /></div><div className="toolbar-meta"><span><span className="status-dot" /> 显示 {filteredCompanies.length} / {totalCompanies} 家</span><div className="level-menu"><button className="ghost-button" onClick={() => setLevelMenuOpen((open) => !open)}><Filter size={15} /> {level === '全部' ? '关联等级' : level} <ChevronDown size={14} /></button>{levelMenuOpen && <div className="level-menu-popover">{levels.map((item) => <button key={item} className={level === item ? 'selected' : ''} onClick={() => { setLevel(item); setLevelMenuOpen(false) }}>{item}</button>)}</div>}</div></div></div><section className="panel full-panel"><div className="table-head full-company-head"><span>公司</span><span>产业链位置 / 角色</span><span>商业航天暴露</span><span>收盘</span><span>涨跌</span><span>市值</span><span>状态</span></div>{filteredCompanies.length ? filteredCompanies.map((company) => <button key={company.code} className={`table-row full-company-row company-row-button ${selectedCode === company.code ? 'selected' : ''}`} onClick={() => void openDetail(company.code)}><div className="company-cell"><span className="stock-code">{company.code}</span><strong>{company.name}</strong><small>{company.level}</small></div><div className="tag-cell"><span>{company.spaceProfile?.businesses[0]?.secondarySector ?? '待确认'}</span><small>{company.spaceProfile?.businesses[0]?.role ?? '待确认'}</small></div><div className="profile-exposure"><strong>{company.spaceProfile?.commercialRevenueShare ?? '待确认'}</strong><small>{company.spaceProfile?.commercialRevenueConfidence ? `${company.spaceProfile.commercialRevenueConfidence}置信度` : '暂无画像'}</small></div><strong>{company.price}</strong><ToneValue value={formatChange(company.change)} tone={company.change >= 0 ? 'positive' : 'negative'} /><span className="market-cap">{company.marketCap}</span><span className={`signal signal-${company.signalTone}`}>{company.signal}</span><ChevronRight className="detail-chevron" size={15} /></button>) : <div className="company-empty"><Search size={18} /><strong>没有匹配的公司</strong><span>尝试调整筛选条件或清空搜索内容。</span><button className="ghost-button" onClick={clearFilters}>清空筛选</button></div>}</section>{selectedCode && <><button className="detail-drawer-backdrop" aria-label="关闭公司详情" onClick={closeDetail} /><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="公司详情抽屉"><div className="detail-drawer-head"><div><span>COMPANY DETAIL / 公司详情</span><strong>{detail?.company.name ?? selectedCompany?.name ?? '读取中'}</strong><small>{detail?.company.code ?? selectedCompany?.code ?? '--'} · {detail?.company.exchange ?? '研究档案'}</small></div><button className="detail-drawer-close" onClick={closeDetail} aria-label="关闭详情"><X size={16} /></button></div><div className="detail-drawer-body"><CompanyDetailPanel detail={detail} loading={loadingCode === selectedCode} error={detailError} /></div></aside></>}</>
}

function FilterGroup({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <div className="filter-group"><span>{label}</span><div>{options.map((item) => <button key={item} className={value === item ? 'selected' : ''} onClick={() => onChange(item)}>{item}</button>)}</div></div> }

function CompanyDetailPanel({ detail, loading, error }: { detail: CompanyDetail | null; loading: boolean; error: string }) {
  if (loading) return <section className="company-detail company-detail-drawer loading-detail"><RefreshCw className="spin" size={16} /> 正在读取已入库详情…</section>
  if (error) return <section className="company-detail company-detail-drawer detail-error"><AlertTriangle size={16} /> {error}</section>
  if (!detail) return null
  const quote = detail.company.latestQuote
  const chartQuotes = [...detail.quotes].sort((left, right) => left.date.localeCompare(right.date))
  const history = [...chartQuotes].reverse()
  const quoteItems = quote ? [['开盘', quote.open], ['最高', quote.high], ['最低', quote.low], ['收盘', quote.close], ['成交量', compactNumber(quote.volume)], ['成交额', compactNumber(quote.turnover)], ['换手率', quote.turnoverRate === null ? '--' : `${quote.turnoverRate.toFixed(2)}%`], ['PE(TTM)', quote.peTtm], ['PB', quote.pb], ['市值', quote.marketCap]] : []
  return <section className="company-detail company-detail-drawer">
    <div className="detail-top"><div><span className="detail-label">DATABASE PROFILE / 已入库详情</span><h3>{detail.company.name} <small>{detail.company.code} · {detail.company.exchange || '交易所待补充'}</small></h3><p>{detail.company.description || '暂无公司简介入库，可通过 aero_company.description 补充。'}</p></div><span className="detail-level">{detail.company.level}</span></div>
    <div className="detail-tags">{detail.tags.length ? detail.tags.map((tag) => <span key={`${tag.type}-${tag.name}`}><small>{tag.type}</small>{tag.name}</span>) : <em>暂无有效标签</em>}</div>
    <DailyQuoteBarChart quotes={chartQuotes} />
    <div className="detail-grid"><div className="detail-block"><h4>最新行情 <small>{quote?.tradeDate ?? '暂无'}</small></h4>{quote ? <div className="quote-grid">{quoteItems.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : <EmptyDetail text="暂无已入库行情" />}</div><div className="detail-block"><h4>近 20 个交易日 <small>{history.length} 条记录</small></h4>{history.length ? <div className="history-list">{history.slice(-8).map((row) => <div key={row.date}><span>{row.date}</span><strong>{row.close.toFixed(2)}</strong><ToneValue value={row.change === null ? '--' : formatChange(row.change)} tone={(row.change ?? 0) >= 0 ? 'positive' : 'negative'} /></div>)}</div> : <EmptyDetail text="暂无历史行情" />}</div><div className="detail-block"><h4>相关事件 <small>{detail.events.length} 条</small></h4>{detail.events.length ? <div className="detail-list">{detail.events.map((event) => <div key={event.id}><span className={`risk-dot risk-${event.level}`} /><p><small>{event.announcedAt} · {event.type}{event.status ? ` · ${event.status}` : ''}</small>{event.title}</p></div>)}</div> : <EmptyDetail text="暂无相关事件" />}</div><div className="detail-block"><h4>业务事实 <small>{detail.facts.length} 条</small></h4>{detail.facts.length ? <div className="detail-list">{detail.facts.map((fact, index) => <div key={`${fact.title}-${index}`}><span className="fact-type">{fact.type}</span><p><small>{fact.disclosedAt || '日期待补充'} · {fact.state}</small>{fact.title}<b>{fact.content}</b></p></div>)}</div> : <EmptyDetail text="暂无业务事实" />}</div></div>
    {detail.profile ? <SpaceProfile profile={detail.profile} /> : <div className="profile-empty"><Layers3 size={17} /><div><strong>商业航天业务画像待建</strong><span>尚未关联细分板块或收入证据；系统不会用默认值代替缺失数据。</span></div></div>}
  </section>
}

function DailyQuoteBarChart({ quotes }: { quotes: CompanyDetail['quotes'] }) {
  const visibleQuotes = useMemo(() => quotes.slice(-20), [quotes])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(visibleQuotes.length ? visibleQuotes.length - 1 : null)

  useEffect(() => {
    setHoveredIndex(visibleQuotes.length ? visibleQuotes.length - 1 : null)
  }, [visibleQuotes])

  if (!visibleQuotes.length) {
    return <section className="quote-chart-card"><div className="quote-chart-head"><div><span>DAILY BAR / 日行情柱状图</span><h4>最近 20 个交易日</h4></div></div><EmptyDetail text="暂无可展示的日行情" /></section>
  }

  const closes = visibleQuotes.map((item) => item.close)
  const highs = visibleQuotes.map((item) => item.high)
  const lows = visibleQuotes.map((item) => item.low)
  const maxClose = Math.max(...closes)
  const minClose = Math.min(...closes)
  const maxHigh = Math.max(...highs)
  const minLow = Math.min(...lows)
  const hovered = hoveredIndex === null ? null : visibleQuotes[hoveredIndex]
  const hoveredLeft = hoveredIndex === null ? '50%' : `${((hoveredIndex + 0.5) / visibleQuotes.length) * 100}%`

  return <section className="quote-chart-card">
    <div className="quote-chart-head">
      <div><span>DAILY BAR / 日行情柱状图</span><h4>最近 20 个交易日</h4></div>
      <small>按收盘价绘制，颜色表示当日涨跌</small>
    </div>
    <div className="quote-chart-shell">
      {hovered && <div className="quote-tooltip" style={{ left: hoveredLeft }}>
        <strong>{hovered.date}</strong>
        <span>开盘 {hovered.open.toFixed(2)} / 最高 {hovered.high.toFixed(2)}</span>
        <span>最低 {hovered.low.toFixed(2)} / 收盘 {hovered.close.toFixed(2)}</span>
        <span>{hovered.change === null ? '涨跌幅 --' : `涨跌幅 ${formatChange(hovered.change)}`}</span>
      </div>}
      <div className="quote-chart-grid" aria-label="最近 20 个交易日日行情柱状图">
        {visibleQuotes.map((item, index) => {
          const height = maxClose === minClose ? 48 : Math.round(((item.close - minClose) / (maxClose - minClose)) * 124 + 28)
          const wickHeight = maxHigh === minLow ? 20 : Math.max(18, Math.round(((item.high - item.low) / Math.max(0.01, maxHigh - minLow)) * 132))
          const tone = (item.change ?? 0) >= 0 ? 'up' : 'down'
          const active = index === hoveredIndex
          return <button
            key={item.date}
            className={`quote-bar-item ${tone} ${active ? 'active' : ''}`}
            onMouseEnter={() => setHoveredIndex(index)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex((current) => current === index ? null : current)}
            aria-label={`${item.date} 收盘 ${item.close.toFixed(2)}，${item.change === null ? '涨跌幅待确认' : `涨跌幅 ${formatChange(item.change)}`}`}
          >
            <span className="quote-bar-wick" style={{ height: `${wickHeight}px` }} />
            <span className="quote-bar-body" style={{ height: `${height}px` }} />
            <small>{index === 0 || index === visibleQuotes.length - 1 || index % 5 === 0 ? item.date.slice(5) : ''}</small>
          </button>
        })}
      </div>
    </div>
  </section>
}

function Score({ value }: { value: number | null }) { return <span className="importance-score" aria-label={value === null ? '重要性待确认' : `重要性 ${value} / 5`}>{value === null ? '待确认' : Array.from({ length: 5 }, (_, index) => <i className={index < value ? 'filled' : ''} key={index} />)}</span> }

function SpaceProfile({ profile }: { profile: CompanySpaceProfile }) {
  return <section className="space-profile">
    <div className="space-profile-head"><div><span>SPACE BUSINESS PROFILE / 可追溯研究画像</span><h4>商业航天业务结构</h4></div><small>更新于 {profile.updatedAt}</small></div>
    <div className="profile-summary"><div className="exposure-card"><span>商业航天占公司总收入</span><strong>{profile.commercialRevenueShare}</strong><small>{profile.commercialRevenueState} · {profile.commercialRevenueConfidence}置信度</small></div><div><span>非商业航天核心业务</span><p>{profile.nonSpaceCoreBusinesses.length ? profile.nonSpaceCoreBusinesses.join(' · ') : '待确认'}</p></div><div><span>研究摘要</span><p>{profile.businessSummary}</p></div></div>
    <div className="business-table"><div className="business-head"><span>细分板块 / 角色</span><span>占商业航天收入</span><span>占公司总收入</span><span>产业链价值量 / 重要性</span><span>证据状态</span></div>{profile.businesses.map((business) => <div className="business-row" key={business.id}><div><small>{business.primarySector}</small><strong>{business.secondarySector}</strong><em className={`role-${business.role}`}>{business.role}</em></div><strong>{business.revenueShare}</strong><strong>{business.companyRevenueShare}</strong><div className="importance-cell"><span>{business.chainValue}</span><Score value={business.chainImportance} /></div><div className="evidence-state"><b>{business.dataState}</b><small>{business.confidence}置信度 · {business.source}</small>{business.note && <em>{business.note}</em>}</div></div>)}</div>
    <div className="profile-foot-grid"><div className="profile-evidence"><h5><CircleCheck size={15} /> 采用证据</h5>{profile.evidences?.length ? profile.evidences.map((item) => <div key={item.id}><strong>{item.title}</strong><span>{item.source} · {item.publishedAt ?? '日期待确认'} · {item.dataState}</span><p>{item.excerpt}</p></div>) : <EmptyDetail text="尚未挂接独立证据记录" />}</div><div className="profile-history"><h5><History size={15} /> 人工维护记录</h5>{profile.revisions?.length ? profile.revisions.map((item) => <div key={item.id}><strong>{item.action} · {item.entityType}{item.isManual ? ' · 人工确认' : ''}</strong><span>{item.createdAt} · {item.operatorName}</span><p>{item.reason || '未填写修改原因'}</p></div>) : <EmptyDetail text="暂无人工维护记录" />}</div></div>
  </section>
}

function EmptyDetail({ text }: { text: string }) { return <div className="empty-detail">{text}</div> }
function compactNumber(value: number | null) { if (value === null) return '--'; if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`; if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万`; return value.toFixed(2) }

function Events({ events, totalEvents, level, setLevel }: { events: EventItem[]; totalEvents: number; level: '全部' | EventItem['level']; setLevel: (value: '全部' | EventItem['level']) => void }) {
  return <><section className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" />事件流 / 今日 {String(totalEvents).padStart(2, '0')} 条</div><h1>重大事项</h1><p className="page-sub">公告经过分类、摘要和风险标记后进入事件时间线。</p></div><button className="primary-button"><FileDown size={15} /> 导出日报</button></section><div className="event-toolbar"><div className="segmented">{(['全部', '高', '中', '低'] as const).map((item) => <button key={item} className={level === item ? 'selected' : ''} onClick={() => setLevel(item)}>{item === '全部' ? '全部事件' : `${item}风险`}</button>)}</div><div className="event-source"><Database size={14} /> {totalEvents} 条来自公告源 · 去重完成</div></div><section className="event-list">{events.map((event) => <article className="event-item" key={event.id}><time>{event.time}</time><div className={`event-marker marker-${event.level}`} /><div className="event-copy"><div className="event-kicker"><span>{event.type}</span><strong>{event.company} <small>{event.code}</small></strong>{event.status && <em>{event.status}</em>}</div><h3>{event.title}</h3><p>{event.detail}</p>{event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">查看原公告 <ChevronRight size={13} /></a> : <span className="event-source-pending">来源待补充</span>}</div><span className={`risk-label risk-${event.level}`}>{event.level}风险</span></article>)}</section></>
}

function syncStatusLabel(status: SyncTaskStatus) {
  return ({ idle: '等待执行', running: '正在同步', success: '最近成功', partial: '部分完成', failed: '同步失败' })[status]
}

function syncTime(value?: string) {
  if (!value) return '尚无记录'
  return new Date(value).toLocaleString('zh-CN', { hour12: false }).replaceAll('/', '-')
}

function SyncCenter({ tasks, selectedTask, setSelectedTask, logs, dailySync, error, onRun, onRunDaily, onRefresh }: { tasks: SyncTask[]; selectedTask: SyncTask['key']; setSelectedTask: (key: SyncTask['key']) => void; logs: SyncLog[]; dailySync: DailySyncState; error: string; onRun: (key: SyncTask['key']) => void; onRunDaily: () => void; onRefresh: () => void }) {
  const selected = tasks.find((task) => task.key === selectedTask)
  const anyTaskRunning = tasks.some((task) => task.running)
  const anyRunning = anyTaskRunning || dailySync.running
  const completed = tasks.filter((task) => task.status === 'success').length
  const failedTasks = tasks.filter((task) => task.status === 'failed' || task.status === 'partial').length
  const currentDailyTask = tasks.find((task) => task.key === dailySync.currentTask)?.label
  return <>
    <section className="page-title-row sync-title-row"><div><div className="eyebrow"><span className="eyebrow-line" />SYNC CONTROL / 数据同步中心</div><h1>同步状态与<br /><span>执行证据</span></h1><p className="page-sub">每次页面触发都会记录任务、进度和原始日志。为降低上游风控，同一时刻只执行一个外部同步任务。</p></div><button className="ghost-button" onClick={onRefresh}><RefreshCw size={15} /> 刷新状态</button></section>
    {error && <div className="data-warning"><AlertTriangle size={15} /> {error}</div>}
    <section className={`daily-sync-card daily-sync-${dailySync.status}`}>
      <div className="daily-sync-orbit" />
      <div className="daily-sync-copy"><span>DAILY CLOSE / 每日盘后流程</span><h2>{dailySync.running ? '正在更新今日数据' : dailySync.enabled ? `每日 ${dailySync.time} 自动更新` : '自动盘后同步已关闭'}</h2><p>{dailySync.running ? `${currentDailyTask ?? '正在准备任务'}${dailySync.retryAt ? `，将于 ${syncTime(dailySync.retryAt)} 重试` : '，完成行情后将自动聚合板块。'}` : `顺序：行情与估值 → 板块聚合。行业、概念和财务保留低频维护，不占用每日更新。`}</p></div>
      <div className="daily-sync-status"><span className={`sync-status-dot status-${dailySync.status}`} /><div><small>{dailySync.running ? '当前状态' : '最近批次'}</small><strong>{dailySync.running ? '执行中' : syncStatusLabel(dailySync.status)}</strong><em>{dailySync.finishedAt ? syncTime(dailySync.finishedAt) : `时区 ${dailySync.timeZone}`}</em></div></div>
      <button className="primary-button daily-sync-button" disabled={anyRunning} onClick={onRunDaily}><Play size={15} className={dailySync.running ? 'spin' : ''} />{dailySync.running ? '盘后同步中' : '立即执行盘后同步'}</button>
      {dailySync.errorMessage && <div className="daily-sync-error"><AlertTriangle size={13} /> {dailySync.errorMessage}</div>}
    </section>
    <section className="sync-summary">
      <div><span>任务覆盖</span><strong>{tasks.length || '--'} <small>项</small></strong><p>行情、归属、财务与板块计算</p></div>
      <div><span>当前执行</span><strong className={anyRunning ? 'sync-live-number' : ''}>{tasks.filter((task) => task.running).length}</strong><p>{dailySync.running ? `盘后流程：${currentDailyTask ?? '准备中'}` : anyRunning ? '正在输出实时日志' : '当前没有运行任务'}</p></div>
      <div><span>最近成功</span><strong>{completed}</strong><p>以最近一次页面任务为准</p></div>
      <div><span>需要关注</span><strong>{failedTasks}</strong><p>{dailySync.retryAt ? `盘后流程将于 ${syncTime(dailySync.retryAt)} 重试` : '失败或部分完成的任务可手动重跑'}</p></div>
    </section>
    <section className="sync-layout">
      <div className="sync-task-list">
        <div className="sync-section-title"><span>PIPELINE / 任务队列</span><small>{anyRunning ? '运行中将自动刷新' : '点击任务即可开始'}</small></div>
        {tasks.map((task) => {
          const isSelected = task.key === selectedTask
          const isBlocked = anyRunning && !task.running
          return <article key={task.key} className={`sync-task-card ${isSelected ? 'selected' : ''} sync-task-${task.status}`} onClick={() => setSelectedTask(task.key)}>
            <div className="sync-task-top"><span className={`sync-status-dot status-${task.status}`} /> <div><strong>{task.label}</strong><small>{task.cadence}</small></div><span className="sync-state-label">{syncStatusLabel(task.status)}</span></div>
            <p>{task.description}</p>
            <div className="sync-task-meta"><span><Database size={12} /> 写入 {task.recordsWritten.toLocaleString('zh-CN')} 条</span><span>{task.warningCount ? `${task.warningCount} 条告警` : '无告警'}</span></div>
            <div className="sync-task-footer"><span>{task.running ? '正在执行，请查看右侧日志' : `最近：${syncTime(task.finishedAt)}`}</span><button className={task.running ? 'ghost-button' : 'sync-run-button'} disabled={task.running || isBlocked} onClick={(event) => { event.stopPropagation(); onRun(task.key) }}><Play size={12} />{task.running ? '执行中' : '运行'}</button></div>
            {task.errorMessage && <div className="sync-task-error"><AlertTriangle size={12} /> {task.errorMessage}</div>}
            {task.retryAt && <div className="sync-task-retry"><Clock3 size={12} /> 将于 {syncTime(task.retryAt)} 自动重试</div>}
          </article>
        })}
      </div>
      <section className="sync-console panel">
        <div className="sync-console-head"><div><span>LIVE LOG / {selected?.label ?? '请选择任务'}</span><strong>{selected?.running ? '实时输出中' : '最近一次运行日志'}</strong></div><div className={selected?.running ? 'console-live' : 'console-idle'}><i /> {selected?.running ? 'LIVE' : 'ARCHIVE'}</div></div>
        <div className="sync-console-context"><span>状态：<b className={`console-status-${selected?.status ?? 'idle'}`}>{selected ? syncStatusLabel(selected.status) : '--'}</b></span><span>开始：{syncTime(selected?.startedAt)}</span><span>{selected?.retryAt ? `下次重试：${syncTime(selected.retryAt)}` : `策略：${selected?.retryEnabled ? '失败后 15 分钟自动重试' : '仅手动或低频执行'}`}</span></div>
        <div className="sync-log-stream" aria-live="polite">{logs.length ? logs.map((log) => <div key={log.id} className={`sync-log-line log-${log.level}`}><time>{log.createdAt ? new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '--:--:--'}</time><span>{log.level === 'error' ? 'ERR' : log.level === 'warn' ? 'WRN' : 'INF'}</span><p>{log.message}</p></div>) : <div className="sync-log-empty"><TerminalSquareIcon />暂无日志。选择任务并点击“运行”后，这里会实时显示公司、数据类型、写入结果与失败原因。</div>}</div>
      </section>
    </section>
  </>
}

function TerminalSquareIcon() { return <Database size={20} /> }

function Reports() {
  return <><section className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" />DAILY BRIEF / 日报归档</div><h1>盘后简报</h1><p className="page-sub">每日自动生成 Markdown 与 PDF，保留当天研究依据和结论。</p></div><button className="primary-button"><FileText size={15} /> 生成今日简报</button></section><section className="report-layout"><div className="panel report-index"><PanelHeading eyebrow="ARCHIVE" title="最近报告" action="" />{['2026-07-10', '2026-07-09', '2026-07-08', '2026-07-07'].map((date, index) => <button className={`report-date ${index === 0 ? 'active' : ''}`} key={date}><span><CalendarDays size={15} />{date}</span><small>{index === 0 ? '已生成 · 18:42' : '已归档'}</small><ChevronRight size={15} /></button>)}</div><div className="panel report-preview"><div className="report-preview-top"><span className="report-label"><FileText size={14} /> MARKDOWN PREVIEW</span><div><button className="ghost-button"><FileText size={14} /> Markdown</button><button className="ghost-button"><FileDown size={14} /> PDF</button></div></div><div className="report-paper"><div className="paper-kicker">轨道观察 · 盘后简报 / 2026.07.10</div><h2>航天相关 A 股<br /><span>今日研究摘要</span></h2><div className="paper-rule" /><p className="paper-lead">商业航天板块今日上涨 2.38%，强度连续三日跑赢基准。公司池内 31 家上涨，4 条重大事项已完成归类。</p><div className="paper-grid"><div><span>01 / 板块</span><strong>商业航天 +2.38%</strong></div><div><span>02 / 风险</span><strong>航宇微 · 减持中</strong></div><div><span>03 / 宏观</span><strong>OMO 净投放 1,250 亿</strong></div></div><div className="paper-foot">数据截止 18:42 · 信息工具，不构成投资建议</div></div></div></section></>
}

export default App
