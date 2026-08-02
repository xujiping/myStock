const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'investment.sqlite');

const RESOURCE_CONFIG = {
  portfolio: {
    table: 'kai_invest_portfolio',
    columns: [
      'list_type', 'stock_code', 'stock_name', 'security_type', 'cost_price', 'cost_amount',
      'quantity', 'position_pct', 'buy_logic', 'trend', 'capital_signal',
      'fundamentals', 'thesis_status', 'action_level', 'action_reason',
      'watch_condition', 'risk_note', 'closed_at', 'source_note',
    ],
    numberColumns: ['cost_price', 'cost_amount', 'quantity', 'position_pct'],
    defaults: {
      list_type: 'holding',
      stock_code: '',
      security_type: 'stock',
      cost_price: 0,
      cost_amount: 0,
      quantity: 0,
      position_pct: 0,
      buy_logic: '',
      trend: '待评估',
      capital_signal: '待评估',
      fundamentals: '待评估',
      thesis_status: '待确认',
      action_level: '观察',
      action_reason: '',
      watch_condition: '',
      risk_note: '',
      closed_at: '',
      source_note: '',
    },
    required: ['stock_name'],
    orderBy: "CASE action_level WHEN '退出' THEN 1 WHEN '减仓' THEN 2 WHEN '观察' THEN 3 ELSE 4 END, updated_at DESC",
  },
  sectors: {
    table: 'kai_invest_sector',
    columns: ['name', 'rating', 'cycle', 'status', 'logic', 'risks', 'indicators', 'updated_note', 'analysis_source', 'analyzed_at', 'analysis_note'],
    numberColumns: ['rating'],
    defaults: {
      rating: 3,
      cycle: '待确认',
      status: '观察',
      logic: '',
      risks: '',
      indicators: '',
      updated_note: '',
      analysis_source: '',
      analyzed_at: '',
      analysis_note: '',
    },
    required: ['name'],
    orderBy: 'rating DESC, updated_at DESC',
  },
  market: {
    table: 'kai_invest_market',
    columns: [
      'record_type', 'name', 'status', 'score', 'risk_level', 'opportunity_level',
      'strategy', 'current_value', 'change_note', 'impact_short', 'impact_mid',
      'metrics_json', 'rationale', 'observed_at', 'analysis_source', 'analyzed_at',
    ],
    numberColumns: ['score', 'risk_level', 'opportunity_level'],
    defaults: {
      record_type: 'market',
      status: '待更新',
      score: 0,
      risk_level: 0,
      opportunity_level: 0,
      strategy: '',
      current_value: '',
      change_note: '',
      impact_short: '',
      impact_mid: '',
      metrics_json: '{}',
      rationale: '',
      observed_at: '',
      analysis_source: '',
      analyzed_at: '',
    },
    required: ['name'],
    orderBy: "CASE record_type WHEN 'account' THEN 1 WHEN 'market' THEN 2 ELSE 3 END, updated_at DESC",
  },
  decisions: {
    table: 'kai_invest_decision',
    columns: [
      'decision_type', 'decision_date', 'title', 'event', 'short_term',
      'mid_term', 'action', 'thesis', 'risk', 'source_type', 'source_ids',
      'confidence', 'review_outcome', 'review_result', 'input_snapshot',
    ],
    numberColumns: ['confidence'],
    defaults: {
      decision_type: 'manual_view',
      decision_date: '',
      title: '',
      event: '',
      short_term: '',
      mid_term: '',
      action: '',
      thesis: '',
      risk: '',
      source_type: '人工记录',
      source_ids: '[]',
      confidence: 0,
      review_outcome: 'pending',
      review_result: '',
      input_snapshot: '',
    },
    required: ['title'],
    orderBy: 'decision_date DESC, created_at DESC',
  },
  trades: {
    table: 'kai_invest_trade_log',
    columns: [
      'portfolio_id', 'stock_code', 'stock_name', 'security_type', 'trade_type', 'trade_date', 'price',
      'quantity', 'before_quantity', 'after_quantity', 'amount', 'reason', 'expectation', 'risk', 'emotion',
      'lesson', 'cost_basis', 'commission_fee', 'stamp_duty', 'transfer_fee',
      'other_fee', 'total_fee', 'net_amount', 'realized_profit',
      'realized_return_pct', 'remaining_quantity',
    ],
    numberColumns: [
      'portfolio_id', 'price', 'quantity', 'before_quantity', 'after_quantity', 'amount', 'cost_basis',
      'commission_fee', 'stamp_duty', 'transfer_fee', 'other_fee',
      'total_fee', 'net_amount', 'realized_profit', 'realized_return_pct',
      'remaining_quantity',
    ],
    defaults: {
      portfolio_id: 0,
      stock_code: '',
      security_type: 'stock',
      trade_type: '买入',
      trade_date: '',
      price: 0,
      quantity: 0,
      before_quantity: 0,
      after_quantity: 0,
      amount: 0,
      reason: '',
      expectation: '',
      risk: '',
      emotion: '',
      lesson: '',
      cost_basis: 0,
      commission_fee: 0,
      stamp_duty: 0,
      transfer_fee: 0,
      other_fee: 0,
      total_fee: 0,
      net_amount: 0,
      realized_profit: 0,
      realized_return_pct: 0,
      remaining_quantity: 0,
    },
    required: ['stock_name'],
    orderBy: 'trade_date DESC, created_at DESC',
  },
};

/**
 * 字段写权限表（AGENTS.md §2.1 的代码化强制）。
 *
 * resource → source → 允许写入的字段；值为 undefined 表示该来源可写全部字段。
 * source 取值：collect（行情采集脚本）/ analyze（AI 分析脚本）/ manual（人工看板）。
 * 规则：默认拒绝、越界抛错；未在表中出现的来源一律拒绝。
 * collect 对 market 的判断字段仅限 CLI 显式传参（collect-market.cjs --score/--risk/--opp/--strategy）。
 */
const FIELD_WRITE_RULES = {
  portfolio: { manual: undefined },
  sectors: {
    collect: ['indicators', 'updated_note'],
    analyze: ['analysis_source', 'analyzed_at', 'analysis_note'],
    manual: undefined,
  },
  market: {
    // collect 只写客观行情与状态标注；判断类字段（score/risk_level/opportunity_level/strategy/rationale）
    // 仅限 analyze（AI 分析）或 manual（人工 / CLI 显式传参 --score 等）写入。见 AGENTS.md §2.1。
    collect: [
      'record_type', 'name', 'current_value', 'change_note', 'impact_short', 'impact_mid',
      'metrics_json', 'observed_at', 'status',
    ],
    analyze: ['score', 'risk_level', 'opportunity_level', 'strategy', 'rationale', 'analysis_source', 'analyzed_at'],
    manual: undefined,
  },
  decisions: { manual: undefined },
  trades: { manual: undefined },
};

function assertWriteAllowed(resource, payload, source) {
  const rules = FIELD_WRITE_RULES[resource];
  if (!rules) return;
  if (!Object.prototype.hasOwnProperty.call(rules, source)) {
    throw Object.assign(new Error(`写入来源 ${source} 无权修改资源 ${resource}（见 AGENTS.md §2.1 字段写权限表）`), { statusCode: 403 });
  }
  const allowed = rules[source];
  if (allowed === undefined) return; // 该来源开放全部字段（人工）
  const denied = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (denied.length) {
    throw Object.assign(new Error(`写入越界：来源 ${source} 修改 ${resource} 的字段 ${denied.join('、')} 被拒绝（见 AGENTS.md §2.1 字段写权限表）`), { statusCode: 403 });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function cleanString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeResource(resource, payload, partial = false) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw Object.assign(new Error('未知资源类型'), { statusCode: 404 });
  const source = partial ? payload : { ...config.defaults, ...payload };
  const result = {};

  for (const column of config.columns) {
    if (!(column in source)) continue;
    if (config.numberColumns.includes(column)) {
      const parsed = Number(source[column]);
      result[column] = Number.isFinite(parsed) ? parsed : 0;
    } else {
      result[column] = cleanString(source[column]);
    }
  }

  if (!partial) {
    for (const field of config.required) {
      if (!result[field]) {
        throw Object.assign(new Error(`缺少必填字段：${field}`), { statusCode: 400 });
      }
    }
  }

  if (resource === 'portfolio' && 'list_type' in result && !['holding', 'watch'].includes(result.list_type)) {
    result.list_type = 'holding';
  }
  if (['portfolio', 'trades'].includes(resource) && 'security_type' in result
    && !['stock', 'fund'].includes(result.security_type)) {
    result.security_type = 'stock';
  }
  if (resource === 'sectors' && 'rating' in result) result.rating = clamp(result.rating, 1, 5);
  if (resource === 'sectors' && 'analysis_note' in result && typeof result.analysis_note !== 'string') {
    try {
      result.analysis_note = JSON.stringify(result.analysis_note);
    } catch {
      result.analysis_note = '';
    }
  }
  if (resource === 'market') {
    if ('record_type' in result && !['account', 'market', 'macro'].includes(result.record_type)) {
      result.record_type = 'market';
    }
    for (const field of ['score', 'risk_level', 'opportunity_level']) {
      if (field in result) result[field] = clamp(result[field], 0, 5);
    }
    if ('metrics_json' in result) {
      try {
        result.metrics_json = JSON.stringify(
          typeof payload.metrics_json === 'string' ? JSON.parse(payload.metrics_json || '{}') : (payload.metrics_json || {}),
        );
      } catch {
        throw Object.assign(new Error('metrics_json 必须是合法 JSON'), { statusCode: 400 });
      }
    }
  }
  if (resource === 'decisions') {
    if (!partial && !result.decision_date) result.decision_date = localDate();
    if ('source_ids' in result && Array.isArray(payload.source_ids)) result.source_ids = JSON.stringify(payload.source_ids);
    if ('input_snapshot' in result && typeof result.input_snapshot !== 'string') {
      try {
        result.input_snapshot = JSON.stringify(result.input_snapshot);
      } catch {
        result.input_snapshot = '';
      }
    }
    if ('confidence' in result) result.confidence = clamp(result.confidence, 0, 100);
    if ('review_outcome' in result && !['pending', 'correct', 'partial', 'wrong'].includes(result.review_outcome)) {
      result.review_outcome = 'pending';
    }
  }
  if (resource === 'trades') {
    if (!partial && !result.trade_date) result.trade_date = localDate();
    // 仅当调用方未显式提供 amount 时，才用 price*quantity 兜底计算。
    // 注意：不能用 !result.amount 判断，否则显式 amount:0（如分红入账）会被误算。
    const hasAmount = Object.prototype.hasOwnProperty.call(payload, 'amount') && payload.amount != null;
    if (!hasAmount && result.price && result.quantity) {
      result.amount = roundNumber(result.price * Math.abs(result.quantity), 2);
    }
  }

  return result;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrateRow(resource, row) {
  if (!row) return null;
  const result = { ...row };
  if (resource === 'market') result.metrics = parseJson(result.metrics_json || '{}', {});
  if (resource === 'decisions') result.sources = parseJson(result.source_ids || '[]', []);
  return result;
}

function normalizeReviewItems(value) {
  if (!Array.isArray(value)) return [];
  const allowedStatuses = new Set(['pending', 'done', 'deferred', 'ignored']);
  const allowedTones = new Set(['risk', 'pending', 'good']);
  return value.slice(0, 20).map((item, index) => ({
    key: cleanString(item?.key).slice(0, 160) || `item-${index + 1}`,
    title: cleanString(item?.title).slice(0, 200),
    detail: cleanString(item?.detail).slice(0, 1200),
    tone: allowedTones.has(item?.tone) ? item.tone : 'pending',
    sourceLabel: cleanString(item?.sourceLabel).slice(0, 80),
    sourcePage: cleanString(item?.sourcePage).slice(0, 40),
    sourceAction: cleanString(item?.sourceAction).slice(0, 40),
    status: allowedStatuses.has(item?.status) ? item.status : 'pending',
    note: cleanString(item?.note).slice(0, 1200),
    updatedAt: cleanString(item?.updatedAt).slice(0, 40),
  })).filter((item) => item.title);
}

class InvestmentStore {
  constructor(databasePath = process.env.INVESTMENT_DB_PATH || DEFAULT_DB_PATH) {
    this.databasePath = databasePath;
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kai_invest_portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_type TEXT NOT NULL DEFAULT 'holding' CHECK (list_type IN ('holding', 'watch')),
        stock_code TEXT NOT NULL DEFAULT '',
        stock_name TEXT NOT NULL,
        security_type TEXT NOT NULL DEFAULT 'stock',
        cost_price REAL NOT NULL DEFAULT 0,
        quantity REAL NOT NULL DEFAULT 0,
        position_pct REAL NOT NULL DEFAULT 0,
        buy_logic TEXT NOT NULL DEFAULT '',
        trend TEXT NOT NULL DEFAULT '待评估',
        capital_signal TEXT NOT NULL DEFAULT '待评估',
        fundamentals TEXT NOT NULL DEFAULT '待评估',
        thesis_status TEXT NOT NULL DEFAULT '待确认',
        action_level TEXT NOT NULL DEFAULT '观察',
        action_reason TEXT NOT NULL DEFAULT '',
        watch_condition TEXT NOT NULL DEFAULT '',
        risk_note TEXT NOT NULL DEFAULT '',
        closed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kai_invest_sector (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 3 CHECK (rating BETWEEN 1 AND 5),
        cycle TEXT NOT NULL DEFAULT '待确认',
        status TEXT NOT NULL DEFAULT '观察',
        logic TEXT NOT NULL DEFAULT '',
        risks TEXT NOT NULL DEFAULT '',
        indicators TEXT NOT NULL DEFAULT '',
        updated_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kai_invest_market (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_type TEXT NOT NULL DEFAULT 'market' CHECK (record_type IN ('account', 'market', 'macro')),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '待更新',
        score REAL NOT NULL DEFAULT 0,
        risk_level REAL NOT NULL DEFAULT 0,
        opportunity_level REAL NOT NULL DEFAULT 0,
        strategy TEXT NOT NULL DEFAULT '',
        current_value TEXT NOT NULL DEFAULT '',
        change_note TEXT NOT NULL DEFAULT '',
        impact_short TEXT NOT NULL DEFAULT '',
        impact_mid TEXT NOT NULL DEFAULT '',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        rationale TEXT NOT NULL DEFAULT '',
        observed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kai_invest_decision (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_type TEXT NOT NULL DEFAULT 'manual_view',
        decision_date TEXT NOT NULL,
        title TEXT NOT NULL,
        event TEXT NOT NULL DEFAULT '',
        short_term TEXT NOT NULL DEFAULT '',
        mid_term TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        thesis TEXT NOT NULL DEFAULT '',
        risk TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT '人工记录',
        source_ids TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        review_outcome TEXT NOT NULL DEFAULT 'pending' CHECK (review_outcome IN ('pending', 'correct', 'partial', 'wrong')),
        review_result TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kai_invest_trade_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL DEFAULT 0,
        stock_code TEXT NOT NULL DEFAULT '',
        stock_name TEXT NOT NULL,
        security_type TEXT NOT NULL DEFAULT 'stock',
        trade_type TEXT NOT NULL DEFAULT '买入',
        trade_date TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        quantity REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        expectation TEXT NOT NULL DEFAULT '',
        risk TEXT NOT NULL DEFAULT '',
        emotion TEXT NOT NULL DEFAULT '',
        lesson TEXT NOT NULL DEFAULT '',
        cost_basis REAL NOT NULL DEFAULT 0,
        commission_fee REAL NOT NULL DEFAULT 0,
        stamp_duty REAL NOT NULL DEFAULT 0,
        transfer_fee REAL NOT NULL DEFAULT 0,
        other_fee REAL NOT NULL DEFAULT 0,
        total_fee REAL NOT NULL DEFAULT 0,
        net_amount REAL NOT NULL DEFAULT 0,
        realized_profit REAL NOT NULL DEFAULT 0,
        realized_return_pct REAL NOT NULL DEFAULT 0,
        remaining_quantity REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kai_invest_daily_review (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_date TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
        current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 3),
        items_json TEXT NOT NULL DEFAULT '[]',
        summary_note TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS kai_invest_portfolio_type_idx
        ON kai_invest_portfolio (list_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS kai_invest_market_type_idx
        ON kai_invest_market (record_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS kai_invest_decision_date_idx
        ON kai_invest_decision (decision_date DESC);
      CREATE INDEX IF NOT EXISTS kai_invest_trade_date_idx
        ON kai_invest_trade_log (trade_date DESC);
      CREATE INDEX IF NOT EXISTS kai_invest_daily_review_status_idx
        ON kai_invest_daily_review (status, review_date DESC);

      CREATE TABLE IF NOT EXISTS kai_invest_stock_fundamentals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_code TEXT NOT NULL UNIQUE,
        stock_name TEXT NOT NULL DEFAULT '',
        report_date TEXT NOT NULL DEFAULT '',
        report_type TEXT NOT NULL DEFAULT '',
        secucode TEXT NOT NULL DEFAULT '',
        indicator TEXT NOT NULL DEFAULT '按报告期',
        notice_date TEXT NOT NULL DEFAULT '',
        update_date TEXT NOT NULL DEFAULT '',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        provider TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS kai_invest_stock_fundamentals_code_idx
        ON kai_invest_stock_fundamentals (stock_code, updated_at DESC);

      CREATE TABLE IF NOT EXISTS kai_invest_stock_quote (
        stock_code TEXT PRIMARY KEY,
        stock_name TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        change_pct REAL NOT NULL DEFAULT 0,
        observed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS kai_invest_operation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'system',
        operation_key TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
        trigger_source TEXT NOT NULL DEFAULT 'dashboard',
        summary TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS kai_invest_operation_log_started_idx
        ON kai_invest_operation_log (started_at DESC);
      CREATE INDEX IF NOT EXISTS kai_invest_operation_log_category_idx
        ON kai_invest_operation_log (category, status, started_at DESC);
    `);
    this.ensureColumns('kai_invest_portfolio', {
      security_type: "TEXT NOT NULL DEFAULT 'stock'",
      closed_at: "TEXT NOT NULL DEFAULT ''",
      source_note: "TEXT NOT NULL DEFAULT ''",
      cost_amount: 'REAL NOT NULL DEFAULT 0',
    });
    this.ensureColumns('kai_invest_decision', {
      review_outcome: "TEXT NOT NULL DEFAULT 'pending'",
      input_snapshot: "TEXT NOT NULL DEFAULT ''",
    });
    this.ensureColumns('kai_invest_trade_log', {
      portfolio_id: 'INTEGER NOT NULL DEFAULT 0',
      before_quantity: 'REAL NOT NULL DEFAULT 0',
      after_quantity: 'REAL NOT NULL DEFAULT 0',
      security_type: "TEXT NOT NULL DEFAULT 'stock'",
      cost_basis: 'REAL NOT NULL DEFAULT 0',
      commission_fee: 'REAL NOT NULL DEFAULT 0',
      stamp_duty: 'REAL NOT NULL DEFAULT 0',
      transfer_fee: 'REAL NOT NULL DEFAULT 0',
      other_fee: 'REAL NOT NULL DEFAULT 0',
      total_fee: 'REAL NOT NULL DEFAULT 0',
      net_amount: 'REAL NOT NULL DEFAULT 0',
      realized_profit: 'REAL NOT NULL DEFAULT 0',
      realized_return_pct: 'REAL NOT NULL DEFAULT 0',
      remaining_quantity: 'REAL NOT NULL DEFAULT 0',
    });
    this.ensureColumns('kai_invest_market', {
      analysis_source: "TEXT NOT NULL DEFAULT ''",
      analyzed_at: "TEXT NOT NULL DEFAULT ''",
    });
    this.ensureColumns('kai_invest_sector', {
      analysis_source: "TEXT NOT NULL DEFAULT ''",
      analyzed_at: "TEXT NOT NULL DEFAULT ''",
      analysis_note: "TEXT NOT NULL DEFAULT ''",
    });
    this.migrateDropPortfolioCurrentPrice();
    this.seed();
  }

  ensureColumns(table, columns) {
    const existing = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  /** 移除已废弃的 current_price 列：行情价功能已下线（价格由交易软件维护）。
   *  旧库重建 kai_invest_portfolio 表（保留数据、CHECK 约束与索引），新库自动跳过。 */
  migrateDropPortfolioCurrentPrice() {
    const columns = this.db.prepare('PRAGMA table_info(kai_invest_portfolio)').all();
    if (!columns.some((item) => item.name === 'current_price')) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
        CREATE TABLE kai_invest_portfolio_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          list_type TEXT NOT NULL DEFAULT 'holding' CHECK (list_type IN ('holding', 'watch')),
          stock_code TEXT NOT NULL DEFAULT '',
          stock_name TEXT NOT NULL,
          security_type TEXT NOT NULL DEFAULT 'stock',
          cost_price REAL NOT NULL DEFAULT 0,
          quantity REAL NOT NULL DEFAULT 0,
          position_pct REAL NOT NULL DEFAULT 0,
          buy_logic TEXT NOT NULL DEFAULT '',
          trend TEXT NOT NULL DEFAULT '待评估',
          capital_signal TEXT NOT NULL DEFAULT '待评估',
          fundamentals TEXT NOT NULL DEFAULT '待评估',
          thesis_status TEXT NOT NULL DEFAULT '待确认',
          action_level TEXT NOT NULL DEFAULT '观察',
          action_reason TEXT NOT NULL DEFAULT '',
          watch_condition TEXT NOT NULL DEFAULT '',
          risk_note TEXT NOT NULL DEFAULT '',
          closed_at TEXT NOT NULL DEFAULT '',
          source_note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO kai_invest_portfolio_new (
          id, list_type, stock_code, stock_name, security_type, cost_price,
          quantity, position_pct, buy_logic, trend, capital_signal, fundamentals,
          thesis_status, action_level, action_reason, watch_condition, risk_note,
          closed_at, source_note, created_at, updated_at
        )
        SELECT id, list_type, stock_code, stock_name, security_type, cost_price,
          quantity, position_pct, buy_logic, trend, capital_signal, fundamentals,
          thesis_status, action_level, action_reason, watch_condition, risk_note,
          closed_at, source_note, created_at, updated_at
        FROM kai_invest_portfolio;
        DROP TABLE kai_invest_portfolio;
        ALTER TABLE kai_invest_portfolio_new RENAME TO kai_invest_portfolio;
        CREATE INDEX IF NOT EXISTS kai_invest_portfolio_type_idx
          ON kai_invest_portfolio (list_type, updated_at DESC);
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  seed() {
    const marketCount = this.db.prepare('SELECT COUNT(*) AS count FROM kai_invest_market').get().count;
    if (!marketCount) {
      const today = localDate();
      this.create('market', {
        record_type: 'account',
        name: '我的投资账户',
        status: '中高风险',
        metrics_json: {
          totalAssets: 180000,
          stockMarketValue: 180000,
          availableCash: 0,
          accumulatedReturn: -18,
          maxDrawdown: 18,
          annualTarget: 22,
        },
        rationale: '按需求文档中的初始值建立，可在总览中随时修改。',
        observed_at: today,
      });
      this.create('market', {
        record_type: 'market',
        name: 'A股市场环境',
        status: '待更新',
        score: 0,
        risk_level: 0,
        opportunity_level: 0,
        strategy: '补充指数、成交量与市场情绪后，再形成整体策略。',
        rationale: '尚未接入实时行情，系统不会把缺失数据包装成市场结论。',
        observed_at: today,
        metrics_json: {
          indexTrend: '待录入',
          turnover: '待录入',
          northbound: '待录入',
          sentiment: '待录入',
          advanceDecline: '待录入',
          themePersistence: '待录入',
        },
      });
      for (const item of [
        {
          record_type: 'macro',
          name: '美联储',
          status: '待更新',
          current_value: '利率与政策信号待录入',
          change_note: '关注票委态度变化',
          impact_short: '待判断',
          impact_mid: '待判断',
          strategy: '只记录对持仓有影响的变化',
          observed_at: today,
        },
        {
          record_type: 'macro',
          name: '黄金变量',
          status: '待更新',
          current_value: '国际金价 / 美元指数 / 美债收益率',
          change_note: '等待录入最新变化',
          impact_short: '待判断',
          impact_mid: '待判断',
          observed_at: today,
        },
        {
          record_type: 'macro',
          name: 'A股资金',
          status: '待更新',
          current_value: '两市成交额 / 北向资金 / 融资余额 / 主力资金',
          change_note: '等待录入最新变化',
          impact_short: '待判断',
          impact_mid: '待判断',
          observed_at: today,
        },
      ]) this.create('market', item);
    }

    const sectorCount = this.db.prepare('SELECT COUNT(*) AS count FROM kai_invest_sector').get().count;
    if (!sectorCount) {
      for (const item of [
        {
          name: '黄金',
          rating: 4,
          cycle: '中期',
          status: '重点跟踪',
          logic: '美联储降息预期\n全球央行购金\n避险需求',
          risks: '美元反弹\n实际利率上升',
          indicators: '国际金价\n美元指数\n美债收益率',
          updated_note: '来自 V1.0 需求文档的初始板块框架',
        },
        {
          name: '猪肉',
          rating: 3,
          cycle: '周期观察',
          status: '观察',
          logic: '猪周期反转预期',
          risks: '产能去化不及预期\n猪价持续性不足',
          indicators: '能繁母猪数量\n猪价走势\n上市公司盈利修复',
          updated_note: '来自 V1.0 需求文档的初始板块框架',
        },
        {
          name: '商业航天',
          rating: 3,
          cycle: '长期',
          status: '等待资金回流',
          logic: '产业长期空间较大',
          risks: '短期资金退潮\n主题交易波动较大',
          indicators: '成交量\n核心标的强度\n政策与订单兑现',
          updated_note: '来自 V1.0 需求文档的初始板块框架',
        },
      ]) this.create('sectors', item);
    }
  }

  list(resource, filters = {}) {
    const config = RESOURCE_CONFIG[resource];
    if (!config) throw Object.assign(new Error('未知资源类型'), { statusCode: 404 });
    const where = [];
    const params = {};
    if (resource === 'portfolio' && filters.list_type) {
      where.push('list_type = :list_type');
      params.list_type = filters.list_type;
    }
    if (resource === 'market' && filters.record_type) {
      where.push('record_type = :record_type');
      params.record_type = filters.record_type;
    }
    const sql = `SELECT * FROM ${config.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${config.orderBy}`;
    return this.db.prepare(sql).all(params).map((row) => hydrateRow(resource, row));
  }

  get(resource, id) {
    const config = RESOURCE_CONFIG[resource];
    if (!config) throw Object.assign(new Error('未知资源类型'), { statusCode: 404 });
    return hydrateRow(resource, this.db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(Number(id)));
  }

  create(resource, payload, options = {}) {
    const config = RESOURCE_CONFIG[resource];
    const source = options.source || 'manual';
    const values = normalizeResource(resource, payload);
    assertWriteAllowed(resource, values, source);
    const timestamp = nowIso();
    const columns = [...Object.keys(values), 'created_at', 'updated_at'];
    const params = { ...values, created_at: timestamp, updated_at: timestamp };
    const placeholders = columns.map((column) => `:${column}`);
    const result = this.db.prepare(
      `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    ).run(params);
    if (resource === 'portfolio') {
      this.recalcPositionPct();
      return this.get(resource, Number(result.lastInsertRowid));
    }
    return this.get(resource, Number(result.lastInsertRowid));
  }

  update(resource, id, payload, options = {}) {
    const config = RESOURCE_CONFIG[resource];
    const source = options.source || 'manual';
    const current = this.get(resource, id);
    if (!current) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
    const values = normalizeResource(resource, payload, true);
    assertWriteAllowed(resource, values, source);
    if (!Object.keys(values).length) return current;
    values.updated_at = nowIso();
    const assignments = Object.keys(values).map((column) => `${column} = :${column}`);
    this.db.prepare(
      `UPDATE ${config.table} SET ${assignments.join(', ')} WHERE id = :id`,
    ).run({ ...values, id: Number(id) });
    if (resource === 'portfolio') {
      this.recalcPositionPct();
      return this.get(resource, id);
    }
    return this.get(resource, id);
  }

  delete(resource, id) {
    const config = RESOURCE_CONFIG[resource];
    if (!config) throw Object.assign(new Error('未知资源类型'), { statusCode: 404 });
    const current = this.get(resource, id);
    if (!current) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
    this.db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(Number(id));
    if (resource === 'portfolio') this.recalcPositionPct();
    return current;
  }

  startOperation(payload = {}) {
    const timestamp = nowIso();
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const result = this.db.prepare(`
      INSERT INTO kai_invest_operation_log (
        category, operation_key, title, status, trigger_source, summary, details,
        metadata_json, started_at, finished_at, duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, '', 0, ?, ?)
    `).run(
      cleanString(payload.category).slice(0, 40) || 'system',
      cleanString(payload.operationKey).slice(0, 80),
      cleanString(payload.title).slice(0, 160) || '系统任务',
      cleanString(payload.triggerSource).slice(0, 40) || 'dashboard',
      cleanString(payload.summary).slice(0, 1200) || '任务已开始',
      cleanString(payload.details).slice(-20000),
      JSON.stringify(metadata).slice(0, 8000),
      cleanString(payload.startedAt) || timestamp,
      timestamp,
      timestamp,
    );
    return this.getOperationLog(Number(result.lastInsertRowid));
  }

  finishOperation(id, payload = {}) {
    const current = this.getOperationLog(id);
    if (!current) throw Object.assign(new Error('运行日志不存在'), { statusCode: 404 });
    const finishedAt = cleanString(payload.finishedAt) || nowIso();
    const startedMs = new Date(current.started_at).getTime();
    const finishedMs = new Date(finishedAt).getTime();
    const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, Math.round(finishedMs - startedMs))
      : 0;
    const status = payload.status === 'failed' ? 'failed' : 'success';
    this.db.prepare(`
      UPDATE kai_invest_operation_log
      SET status = ?, summary = ?, details = ?, metadata_json = ?,
          finished_at = ?, duration_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      cleanString(payload.summary).slice(0, 1200) || (status === 'success' ? '任务已完成' : '任务执行失败'),
      cleanString(payload.details ?? current.details).slice(-20000),
      JSON.stringify(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : current.metadata).slice(0, 8000),
      finishedAt,
      durationMs,
      nowIso(),
      Number(id),
    );
    return this.getOperationLog(id);
  }

  getOperationLog(id) {
    const row = this.db.prepare('SELECT * FROM kai_invest_operation_log WHERE id = ?').get(Number(id));
    if (!row) return null;
    return { ...row, metadata: parseJson(row.metadata_json || '{}', {}) };
  }

  listOperationLogs(filters = {}) {
    const where = [];
    const params = [];
    if (cleanString(filters.category)) {
      where.push('category = ?');
      params.push(cleanString(filters.category));
    }
    if (cleanString(filters.status)) {
      where.push('status = ?');
      params.push(cleanString(filters.status));
    }
    const limit = clamp(Number(filters.limit) || 100, 1, 200);
    const rows = this.db.prepare(`
      SELECT * FROM kai_invest_operation_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit);
    return rows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json || '{}', {}) }));
  }

  getDailyReview(reviewDate = localDate()) {
    const date = cleanString(reviewDate) || localDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw Object.assign(new Error('复盘日期格式应为 YYYY-MM-DD'), { statusCode: 400 });
    }
    const row = this.db.prepare('SELECT * FROM kai_invest_daily_review WHERE review_date = ?').get(date);
    if (!row) return null;
    return { ...row, items: parseJson(row.items_json || '[]', []) };
  }

  listDailyReviews(limit = 7) {
    const safeLimit = clamp(Number(limit) || 7, 1, 31);
    return this.db.prepare(
      'SELECT * FROM kai_invest_daily_review ORDER BY review_date DESC LIMIT ?',
    ).all(safeLimit).map((row) => ({ ...row, items: parseJson(row.items_json || '[]', []) }));
  }

  // 决策复盘命中率统计：已复盘的决策中，各结论占比与时间窗
  decisionReviewStats(days = 90) {
    const windowDays = clamp(Number(days) || 90, 1, 365);
    const rows = this.db.prepare(
      `SELECT review_outcome, COUNT(*) AS cnt
       FROM kai_invest_decision
       WHERE review_outcome != 'pending'
         AND decision_date >= date('now', '-${windowDays} days', 'localtime')
       GROUP BY review_outcome`,
    ).all();
    const map = { correct: 0, partial: 0, wrong: 0 };
    for (const r of rows) map[r.review_outcome] = Number(r.cnt) || 0;
    const reviewed = map.correct + map.partial + map.wrong;
    const pending = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM kai_invest_decision
       WHERE review_outcome = 'pending'
         AND decision_date >= date('now', '-${windowDays} days', 'localtime')`,
    ).get().cnt;
    const total = reviewed + Number(pending) || 0;
    // 命中率：correct 计 1，partial 计 0.5
    const hitRate = reviewed ? Math.round(((map.correct + map.partial * 0.5) / reviewed) * 100) : null;
    const reviewRate = total ? Math.round((reviewed / total) * 100) : null;
    return { windowDays, correct: map.correct, partial: map.partial, wrong: map.wrong, pending: Number(pending), reviewed, total, hitRate, reviewRate };
  }

  saveDailyReview(payload = {}, options = {}) {
    // §2.1：每日复盘仅人工填写，AI 不得代填。默认 manual 兼容看板/自检，显式拒绝其它来源。
    const source = options.source || 'manual';
    if (source !== 'manual') {
      throw Object.assign(new Error(`每日复盘仅允许人工写入（来源 ${source} 被拒绝，见 AGENTS.md §2.1）`), { statusCode: 403 });
    }
    const reviewDate = cleanString(payload.review_date) || localDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
      throw Object.assign(new Error('复盘日期格式应为 YYYY-MM-DD'), { statusCode: 400 });
    }
    const existing = this.getDailyReview(reviewDate);
    const timestamp = nowIso();
    const status = payload.status === 'completed' ? 'completed' : 'in_progress';
    const currentStep = clamp(Number(payload.current_step) || existing?.current_step || 1, 1, 3);
    const items = normalizeReviewItems(payload.items ?? existing?.items ?? []);
    const completedAt = status === 'completed'
      ? (cleanString(payload.completed_at) || existing?.completed_at || timestamp)
      : '';
    const params = {
      review_date: reviewDate,
      status,
      current_step: currentStep,
      items_json: JSON.stringify(items),
      summary_note: cleanString(payload.summary_note ?? existing?.summary_note).slice(0, 2400),
      started_at: cleanString(payload.started_at) || existing?.started_at || timestamp,
      completed_at: completedAt,
      created_at: existing?.created_at || timestamp,
      updated_at: timestamp,
    };
    this.db.prepare(`
      INSERT INTO kai_invest_daily_review (
        review_date, status, current_step, items_json, summary_note,
        started_at, completed_at, created_at, updated_at
      ) VALUES (
        :review_date, :status, :current_step, :items_json, :summary_note,
        :started_at, :completed_at, :created_at, :updated_at
      )
      ON CONFLICT(review_date) DO UPDATE SET
        status = excluded.status,
        current_step = excluded.current_step,
        items_json = excluded.items_json,
        summary_note = excluded.summary_note,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `).run(params);
    return this.getDailyReview(reviewDate);
  }

  /**
   * 更新持仓（含数量变化）：数量变化时必填变更原因，并自动生成一条持仓变更记录。
   *
   * 设计边界：系统不做盈亏金额/市值/费用计算（金额类以交易软件为准），
   * 只维护 成本价格 + 数量 + 持仓逻辑；最新价格与浮盈/浮亏率由行情刷新（kai_invest_stock_quote）提供。
   * 每次数量变化都留痕（原数量 → 新数量 + 原因）。
   * 数量变为 0 视为清仓（自动标记 closed_at / action_level=退出），
   * 数量从 0 恢复为正值视为重新持有（清除 closed_at）。
   *
   * @param {number|string} id 持仓记录 id
   * @param {object} payload 普通持仓字段 + change_reason（数量变化时必填）+ trade_date（可选，默认今天）
   */
  updateHoldingWithChange(id, payload = {}) {
    const current = this.get('portfolio', id);
    if (!current) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
    if (current.list_type !== 'holding') {
      // 关注列表等非持仓记录走普通更新
      return { holding: this.update('portfolio', id, payload), change: null };
    }

    const nextQuantity = Number(payload.quantity);
    const quantityChanged = Number.isFinite(nextQuantity) && nextQuantity !== Number(current.quantity);
    const changeReason = cleanString(payload.change_reason);
    if (quantityChanged && !changeReason) {
      throw Object.assign(new Error('持仓数量发生变化时必须填写变更原因'), { statusCode: 400 });
    }

    const next = { ...payload };
    delete next.change_reason;
    if (quantityChanged) {
      if (nextQuantity <= 0) {
        next.closed_at = cleanString(payload.trade_date) || localDate();
        next.action_level = '退出';
      } else if (Number(current.quantity) <= 0 && current.closed_at) {
        next.closed_at = '';
        next.action_level = '观察';
      }
    }
    const holding = this.update('portfolio', id, next);

    let change = null;
    if (quantityChanged) {
      const delta = nextQuantity - Number(current.quantity);
      const tradeType = delta > 0
        ? (Number(current.quantity) <= 0 ? '买入' : '加仓')
        : (nextQuantity <= 0 ? '卖出' : '减仓');
      // 成交价优先取本次传入，其次回退持仓成本价；让 amount 能在 normalize 时兜底算出
      const tradePrice = Number(payload.price) || Number(holding.cost_price) || 0;
      change = this.create('trades', {
        portfolio_id: Number(id),
        stock_code: holding.stock_code,
        stock_name: holding.stock_name,
        security_type: holding.security_type,
        trade_type: tradeType,
        trade_date: cleanString(payload.trade_date) || localDate(),
        price: tradePrice,
        quantity: Math.abs(delta),
        before_quantity: Number(current.quantity),
        after_quantity: nextQuantity,
        reason: changeReason,
      });
    }
    return { holding, change };
  }


  // 批量写入/更新行情快照（§2.1：stock_quote 表只写客观行情，不做盈亏计算；仅 collect-quotes.cjs / 自检脚本调用）
  saveQuotes(quotes = []) {
    const upsert = this.db.prepare(`
      INSERT INTO kai_invest_stock_quote (stock_code, stock_name, price, change_pct, observed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_code) DO UPDATE SET
        stock_name = excluded.stock_name,
        price = excluded.price,
        change_pct = excluded.change_pct,
        observed_at = excluded.observed_at,
        updated_at = excluded.updated_at
    `);
    const timestamp = nowIso();
    let count = 0;
    for (const q of quotes) {
      const code = cleanString(q.stock_code);
      if (!code) continue;
      upsert.run(
        code,
        cleanString(q.stock_name),
        Number(q.price) || 0,
        Number(q.change_pct) || 0,
        cleanString(q.observed_at) || '',
        timestamp,
      );
      count += 1;
    }
    return count;
  }

  listQuotes() {
    return this.db.prepare(
      'SELECT stock_code, stock_name, price, change_pct, observed_at, updated_at FROM kai_invest_stock_quote',
    ).all();
  }

  // 持仓比例 = 该持仓成本价格 × 数量 / 所有活跃持仓成本金额（价格×数量）之和 × 100，写入库保持数据一致
  // 包在事务内：避免并发请求（看板编辑 + 行情采集）读到中间态的 position_pct
  recalcPositionPct() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.db.prepare(`
        SELECT id, cost_price, quantity FROM kai_invest_portfolio
        WHERE list_type = 'holding' AND quantity > 0 AND (closed_at IS NULL OR closed_at = '')
      `).all();
      const total = rows.reduce((sum, row) => sum + (Number(row.cost_price) || 0) * (Number(row.quantity) || 0), 0);
      const update = this.db.prepare('UPDATE kai_invest_portfolio SET position_pct = ? WHERE id = ?');
      for (const row of rows) {
        const cost = (Number(row.cost_price) || 0) * (Number(row.quantity) || 0);
        update.run(total > 0 ? (cost / total) * 100 : 0, row.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    // 幂等关闭：重复调用（如 server.on('close') 与 shutdown 显式调用同时触发）不再抛错
    if (this._closed) return;
    this._closed = true;
    this.db.close();
  }
}

module.exports = {
  InvestmentStore,
  RESOURCE_CONFIG,
  DEFAULT_DB_PATH,
  localDate,
};
