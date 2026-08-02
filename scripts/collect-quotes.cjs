/**
 * 个股行情采集：新浪 hq.sinajs.cn 批量接口。
 *
 * 只采集客观行情（最新价、当日涨跌幅），不做任何盈亏金额计算；
 * 浮盈/浮亏率由看板按「最新价 vs 成本价格」在装配时计算。
 *
 * CLI：node scripts/collect-quotes.cjs [--dry-run] [--only=代码,代码...]
 * serve.cjs 的 POST /api/investment/quotes/refresh 与定时任务复用 collectQuotes()。
 */
require('dotenv').config();

const { InvestmentStore } = require('../investment-store.cjs');
const { curl } = require('./lib/net-collect.cjs');
const { parseSinaStocks } = require('./lib/parsers.cjs');

const SINA_QUOTE_URL = 'https://hq.sinajs.cn/list=';
const SINA_REFERER = 'https://finance.sina.com.cn/';

/** 6 位代码 → 新浪前缀：沪市 6/5/9，深市 0/1/2/3，北交所 4/8 */
function toSinaCode(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return '';
  if (/^[569]/.test(c)) return `sh${c}`;
  if (/^[0123]/.test(c)) return `sz${c}`;
  if (/^[48]/.test(c)) return `bj${c}`;
  return '';
}

/**
 * 采集一批 A 股/ETF 的最新行情并写库。
 * @param {InvestmentStore} store
 * @param {Array<string|number>} codes 6 位股票代码
 * @param {{dryRun?: boolean}} options
 * @returns {Promise<{results: Array, errors: Array<{stock_code: string, message: string}>}>}
 */
async function collectQuotes(store, codes, options = {}) {
  const { dryRun = false } = options;
  const sinaCodes = [...new Set(codes.map(toSinaCode).filter(Boolean))];
  if (!sinaCodes.length) {
    return { results: [], errors: [{ stock_code: '', message: '没有可采集的 6 位股票代码' }] };
  }
  // 新浪单次接口可带多个代码，一批拉取
  const r = curl(`${SINA_QUOTE_URL}${sinaCodes.join(',')}`, {
    referer: SINA_REFERER,
    gbk: true,
  });
  if (!r.ok) {
    return { results: [], errors: sinaCodes.map((code) => ({ stock_code: code.slice(2), message: r.error })) };
  }
  const quotes = parseSinaStocks(r.body);
  const results = [];
  const errors = [];
  for (const sinaCode of sinaCodes) {
    const q = quotes[sinaCode];
    const stockCode = sinaCode.slice(2);
    if (!q || !q.price) {
      errors.push({ stock_code: stockCode, message: '接口未返回价格（可能停牌或无数据）' });
      continue;
    }
    results.push({
      stock_code: stockCode,
      stock_name: q.name,
      price: q.price,
      change_pct: q.changePct,
      observed_at: '',
    });
  }
  if (!dryRun && results.length) store.saveQuotes(results);
  return { results, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyIndex = args.indexOf('--only=');
  let only = null;
  if (onlyIndex >= 0) only = args[onlyIndex].slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);

  const store = new InvestmentStore();
  let codes = only;
  if (!codes || !codes.length) {
    codes = store.list('portfolio')
      .filter((item) => {
        const code = String(item.stock_code || '').trim();
        if (!/^\d{6}$/.test(code)) return false;
        if (item.list_type === 'holding') return item.quantity > 0 && !item.closed_at;
        return item.list_type === 'watch';
      })
      .map((item) => String(item.stock_code).trim());
  }
  const result = await collectQuotes(store, codes, { dryRun });
  for (const q of result.results) console.log(`${q.stock_code} ${q.stock_name} ${q.price} (${q.change_pct}%)`);
  for (const e of result.errors) console.error(`失败 ${e.stock_code || '-'}: ${e.message}`);
  store.close();
  process.exit(result.errors.length && !result.results.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { collectQuotes, toSinaCode };
