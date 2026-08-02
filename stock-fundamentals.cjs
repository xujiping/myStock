/*
 * 持仓股财务主要指标采集（阿里云云市场「股票历史行情查询 - 极速数据」）。
 *
 * 仅采集个股财务主要指标（/stockhistory/financialmain），返回含同比的核心指标，
 * 最适合看板「基本面」卡片。行情类需求仍走免费接口（新浪/东方财富）。
 *
 * 接口手册见 docs/api-aliyun-stockhistory.md。
 * 认证：Header Authorization: APPCODE <AppCode>，AppCode 仅放 .env。
 */
const DEFAULT_HOST = 'https://jsapigpls.market.alicloudapi.com';
const DEFAULT_PATH = '/stockhistory/financialmain';
const SOURCE_URL = 'https://market.aliyun.com/detail/cmapi00045130#sku=yuncode3913000009';

// 按字母序的原始字段 → 看板字段，只保留对基本面判断有意义的项
const FIELD_MAP = {
  epsjb: '基本每股收益',
  epskcjb: '扣非每股收益',
  epsxs: '稀释每股收益',
  bps: '每股净资产',
  mgzbgj: '每股资本公积',
  mgwfplr: '每股未分配利润',
  mgjyxjje: '每股经营现金流',
  totaloperatereve: '营业总收入',
  mlr: '毛利润',
  parentnetprofit: '归母净利润',
  kcfjcxsyjlr: '扣非净利润',
  totaloperaterevetz: '营收同比(%)',
  parentnetprofittz: '归母净利同比(%)',
  kcfjcxsyjlrtz: '扣非同比(%)',
};

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getConfig() {
  const appCode = String(process.env.STOCK_FUNDAMENTALS_APP_CODE || '').trim();
  if (!appCode) {
    throw Object.assign(
      new Error('股票财务接口尚未配置，请在 .env 填写 STOCK_FUNDAMENTALS_APP_CODE'),
      { statusCode: 503 },
    );
  }
  const host = String(process.env.STOCK_FUNDAMENTALS_HOST || DEFAULT_HOST).replace(/\/$/, '');
  const requestPath = String(process.env.STOCK_FUNDAMENTALS_PATH || DEFAULT_PATH);
  const timeoutMs = Math.max(3000, Number(process.env.STOCK_FUNDAMENTALS_TIMEOUT_MS || 15000));
  return { appCode, host, requestPath, timeoutMs };
}

/**
 * 调用单个股票的财务主要指标接口。
 * @param {string} code 股票代码，如 688808
 * @param {object} options { indicator?: '按报告期'|'按单季度', fetchImpl? }
 */
async function fetchStockFundamentals(code, options = {}) {
  if (!code) throw Object.assign(new Error('股票代码不能为空'), { statusCode: 400 });
  const config = getConfig();
  const params = new URLSearchParams({ code });
  if (options.indicator) params.set('indicator', options.indicator);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(
      `${config.host}${config.requestPath}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `APPCODE ${config.appCode}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    );
    const responseText = await response.text();
    let responseBody = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      // 非 JSON 错误仍按 HTTP 状态处理，不把解析异常盖过真实错误。
    }
    if (!response.ok) {
      // 部分业务错误（例如 status=210「没有信息」）会使用 HTTP 404 返回，
      // 先按统一业务结构解析，避免把整段 JSON 暴露给看板用户。
      if (responseBody && Number(responseBody.status) === 210) {
        return normalizeResponse(code, responseBody);
      }
      // 错误响应里不含密钥，但仍截断避免日志膨胀
      const detail = responseBody?.msg || responseText;
      throw Object.assign(
        new Error(`财务接口请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 120)}` : ''}`),
        { statusCode: 502 },
      );
    }
    return normalizeResponse(code, responseBody);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error(`财务接口请求超时（${config.timeoutMs}ms）`), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeResponse(code, body) {
  if (Number(body?.status) === 210) {
    throw Object.assign(
      new Error(`暂无 ${code} 的公开财务数据（上游状态 210：${body.msg || '没有信息'}）`),
      { statusCode: 404, unavailable: true },
    );
  }
  if (!body || Number(body.status) !== 0 || !body.result) {
    throw Object.assign(new Error(body?.msg || '财务接口返回格式异常'), { statusCode: 502 });
  }
  const result = body.result;
  const list = Array.isArray(result.list) ? result.list : [];
  if (!list.length) {
    throw Object.assign(new Error(`未返回 ${code} 的财务数据`), { statusCode: 502 });
  }
  // 取最新一期（report_date 最大）
  const latest = [...list].sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')))[0];
  const metrics = {};
  for (const [rawKey, label] of Object.entries(FIELD_MAP)) {
    metrics[rawKey] = { label, value: numberOrNull(latest[rawKey]) };
  }
  return {
    provider: '阿里云云市场 · 极速数据',
    sourceUrl: SOURCE_URL,
    stockCode: String(result.code || code),
    stockName: String(result.name || ''),
    indicator: String(latest.indicator || '按报告期'),
    reportDate: String(latest.report_date || ''),
    reportType: String(latest.report_type || ''),
    secucode: String(latest.secucode || ''),
    noticeDate: String(latest.notice_date || ''),
    updateDate: String(latest.update_date || ''),
    fetchedAt: new Date().toISOString(),
    metrics,
  };
}

/**
 * 把单只股票的财务指标写入数据库（按 stock_code upsert）。
 */
function persistFundamentals(store, data) {
  const now = new Date().toISOString();
  const existing = store.db
    .prepare('SELECT id FROM kai_invest_stock_fundamentals WHERE stock_code = ?')
    .get(data.stockCode);
  const row = {
    stock_code: data.stockCode,
    stock_name: data.stockName,
    report_date: data.reportDate,
    report_type: data.reportType,
    secucode: data.secucode,
    indicator: data.indicator,
    notice_date: data.noticeDate,
    update_date: data.updateDate,
    metrics_json: JSON.stringify(data.metrics),
    provider: data.provider,
    source_url: data.sourceUrl,
    fetched_at: data.fetchedAt,
  };
  if (existing) {
    // 注意：node:sqlite 不允许传入 SQL 中不存在的命名参数，
    // UPDATE 不更新 stock_code（它是查询键），因此需要从参数中剔除。
    const { stock_code, ...updateRow } = row;
    store.db
      .prepare(
        `UPDATE kai_invest_stock_fundamentals
         SET stock_name = :stock_name, report_date = :report_date, report_type = :report_type,
             secucode = :secucode, indicator = :indicator, notice_date = :notice_date,
             update_date = :update_date, metrics_json = :metrics_json, provider = :provider,
             source_url = :source_url, fetched_at = :fetched_at, updated_at = :updated_at
         WHERE id = :id`,
      )
      .run({ ...updateRow, updated_at: now, id: existing.id });
    return { id: existing.id, ...data };
  }
  const result = store.db
    .prepare(
      `INSERT INTO kai_invest_stock_fundamentals (
        stock_code, stock_name, report_date, report_type, secucode, indicator,
        notice_date, update_date, metrics_json, provider, source_url, fetched_at,
        created_at, updated_at
      ) VALUES (
        :stock_code, :stock_name, :report_date, :report_type, :secucode, :indicator,
        :notice_date, :update_date, :metrics_json, :provider, :source_url, :fetched_at,
        :created_at, :updated_at
      )`,
    )
    .run({ ...row, created_at: now, updated_at: now });
  return { id: Number(result.lastInsertRowid), ...data };
}

function readFundamentalsRows(store, codes = null) {
  if (codes && codes.length) {
    const placeholders = codes.map(() => '?').join(',');
    return store.db
      .prepare(
        `SELECT * FROM kai_invest_stock_fundamentals
         WHERE stock_code IN (${placeholders})
         ORDER BY updated_at DESC`,
      )
      .all(...codes)
      .map(hydrateRow);
  }
  return store.db
    .prepare('SELECT * FROM kai_invest_stock_fundamentals ORDER BY updated_at DESC')
    .all()
    .map(hydrateRow);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrateRow(row) {
  if (!row) return null;
  return { ...row, metrics: parseJson(row.metrics_json || '{}', {}) };
}

/**
 * 为指定持仓股批量采集财务主要指标。
 * @param {object} store InvestmentStore 实例
 * @param {Array<{stock_code:string,stock_name:string}>} holdings
 * @param {object} options { indicator?, fetchImpl? }
 * @returns {{ results: Array, errors: Array<{code,message}> }}
 */
async function refreshFundamentals(store, holdings, options = {}) {
  const targets = (holdings || [])
    .filter((item) => String(item.stock_code || '').trim())
    .map((item) => ({
      stock_code: String(item.stock_code).trim(),
      stock_name: item.stock_name,
    }));
  const results = [];
  const errors = [];
  for (const target of targets) {
    try {
      const data = await fetchStockFundamentals(target.stock_code, {
        indicator: options.indicator,
        fetchImpl: options.fetchImpl,
      });
      results.push(persistFundamentals(store, data));
    } catch (error) {
      // 单只失败不阻断其余，错误码原样透传给上层
      errors.push({
        stock_code: target.stock_code,
        stock_name: target.stock_name,
        message: error.message,
        statusCode: Number(error.statusCode) || 500,
      });
    }
  }
  return { results, errors };
}

module.exports = {
  SOURCE_URL,
  FIELD_MAP,
  fetchStockFundamentals,
  normalizeResponse,
  persistFundamentals,
  readFundamentalsRows,
  refreshFundamentals,
};
