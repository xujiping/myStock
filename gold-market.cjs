const DEFAULT_HOST = 'https://tsgold2.market.alicloudapi.com';
const DEFAULT_PATH = '/shgold';
const SOURCE_URL = 'https://market.aliyun.com/detail/cmapi00067356#sku=yuncode6135600001';
const PREFERRED_SYMBOLS = ['Au9999', 'AuT+D', 'mAuT+D', 'Au100g'];

let cache = null;

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuote(symbol, value = {}) {
  return {
    symbol,
    name: String(value.typename || symbol),
    price: numberOrNull(value.price),
    buyPrice: numberOrNull(value.buyprice),
    sellPrice: numberOrNull(value.sellprice),
    change: numberOrNull(value.changequantity),
    changePercent: numberOrNull(value.changepercent),
    open: numberOrNull(value.openingprice),
    high: numberOrNull(value.maxprice),
    low: numberOrNull(value.minprice),
    previousClose: numberOrNull(value.lastclosingprice),
    volume: numberOrNull(value.tradeamount),
    unit: String(value.unit || ''),
    updatedAt: String(value.updatetime || ''),
  };
}

function normalizeGoldResponse(body) {
  if (!body || Number(body.code) !== 1 || !body.data?.list || typeof body.data.list !== 'object') {
    throw Object.assign(new Error(body?.msg || '黄金行情接口返回格式异常'), { statusCode: 502 });
  }

  const quotes = Object.entries(body.data.list)
    .map(([symbol, value]) => normalizeQuote(symbol, value))
    .filter((item) => item.price != null)
    .sort((left, right) => {
      const leftIndex = PREFERRED_SYMBOLS.indexOf(left.symbol);
      const rightIndex = PREFERRED_SYMBOLS.indexOf(right.symbol);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
  if (!quotes.length) {
    throw Object.assign(new Error('黄金行情接口没有返回有效报价'), { statusCode: 502 });
  }

  return {
    provider: '阿里云云市场 · 探数API',
    market: '上海黄金交易所',
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    marketUpdatedAt: quotes.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) || '',
    primarySymbol: quotes.some((item) => item.symbol === 'Au9999') ? 'Au9999' : quotes[0].symbol,
    quotes,
  };
}

function getConfig() {
  const appCode = String(process.env.GOLD_MARKET_APP_CODE || '').trim();
  if (!appCode) {
    throw Object.assign(new Error('黄金行情接口尚未配置，请在 .env 填写 GOLD_MARKET_APP_CODE'), {
      statusCode: 503,
    });
  }
  const host = String(process.env.GOLD_MARKET_HOST || DEFAULT_HOST).replace(/\/$/, '');
  const requestPath = String(process.env.GOLD_MARKET_PATH || DEFAULT_PATH);
  const timeoutMs = Math.max(3000, Number(process.env.GOLD_MARKET_TIMEOUT_MS || 15000));
  const cacheMs = Math.max(0, Number(process.env.GOLD_MARKET_CACHE_MS || 300000));
  return { appCode, host, requestPath, timeoutMs, cacheMs };
}

async function fetchGoldMarket(options = {}) {
  const config = getConfig();
  const now = Date.now();
  if (!options.force && cache && now - cache.cachedAt < config.cacheMs) {
    return { ...cache.value, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (options.fetchImpl || fetch)(`${config.host}${config.requestPath}`, {
      method: 'GET',
      headers: {
        Authorization: `APPCODE ${config.appCode}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(
        new Error(`黄金行情请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 120)}` : ''}`),
        { statusCode: 502 },
      );
    }
    const value = normalizeGoldResponse(await response.json());
    cache = { cachedAt: now, value };
    return { ...value, cached: false };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error(`黄金行情请求超时（${config.timeoutMs}ms）`), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function quoteDirection(quote) {
  if ((quote.changePercent || 0) > 0) return '上涨';
  if ((quote.changePercent || 0) < 0) return '下跌';
  return '平盘';
}

function syncGoldMacro(store, marketData) {
  const primary = marketData.quotes.find((item) => item.symbol === marketData.primarySymbol) || marketData.quotes[0];
  const existing = store.list('market', { record_type: 'macro' })
    .find((item) => item.name === '黄金变量');
  const changePct = `${primary.changePercent > 0 ? '+' : ''}${Number(primary.changePercent || 0).toFixed(2)}%`;
  const payload = {
    record_type: 'macro',
    name: '黄金变量',
    status: quoteDirection(primary),
    current_value: `${primary.name} ${primary.price.toFixed(2)} ${primary.unit}`,
    // change_note 承载涨跌幅与数据来源说明（rationale 属判断字段，collect 不可写，见 AGENTS.md §2.1）
    change_note: `${changePct} · 高 ${primary.high ?? '—'} · 低 ${primary.low ?? '—'} · 来源：${marketData.provider}（上海黄金交易所）`,
    metrics_json: {
      provider: marketData.provider,
      market: marketData.market,
      sourceUrl: marketData.sourceUrl,
      primarySymbol: marketData.primarySymbol,
      marketUpdatedAt: marketData.marketUpdatedAt,
      quotes: marketData.quotes,
    },
    observed_at: marketData.marketUpdatedAt || marketData.fetchedAt,
  };
  // 显式声明来源为 collect，仅写 §2.1 允许的 macro 采集字段（current_value/change_note/metrics_json/observed_at/status）
  const options = { source: 'collect' };
  return existing ? store.update('market', existing.id, payload, options) : store.create('market', payload, options);
}

async function refreshGoldMarket(store, options = {}) {
  const market = await fetchGoldMarket(options);
  const macro = syncGoldMacro(store, market);
  return { ...market, macro };
}

function clearGoldMarketCache() {
  cache = null;
}

module.exports = {
  SOURCE_URL,
  clearGoldMarketCache,
  fetchGoldMarket,
  normalizeGoldResponse,
  refreshGoldMarket,
  syncGoldMacro,
};
