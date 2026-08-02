/*
 * 单元测试：行情解析 + 持仓计费 + store 校验。
 *
 * 使用 Node 内置 node:test（v22+），无需安装任何依赖。
 * 与 check-investment.cjs（端到端自检）互补：这里只测纯函数与边界条件。
 *
 * 运行：node --test scripts/test/parsers-and-store.test.cjs
 *       npm test
 */
// 注：本测试 require 了 serve.cjs（取 checkLocalOrigin），serve 顶部会 require('dotenv').config()，
// 故 .env 凭据会进入测试进程。所有涉及网络的测试（fetchStockFundamentals）均用 fetchImpl mock，
// 不会触发真实计费接口。若后续拆分 serve.cjs（P2-B1）去除 require 时副作用，可移除 dotenv 依赖。
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseSinaQuote,
  parseSinaStocks,
  parseSinaBoard,
  parseMainFunds,
  parseAdvanceDecline,
} = require('../lib/parsers.cjs');
const { InvestmentStore } = require('../../investment-store.cjs');
const {
  fetchStockFundamentals,
  normalizeResponse,
  persistFundamentals,
} = require('../../stock-fundamentals.cjs');

// ── 新浪行情解析 ────────────────────────────────────────────────

test('parseSinaQuote: 解析沪深指数，含涨跌幅与成交额', () => {
  const body = 'var hq_str_sh000001="上证指数,3833.5359,3804.6926,3832.2624,3847.0926,3822.3736,0,0,597529427,1187681546393,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-07-31,15:30:36,00,";';
  const q = parseSinaQuote(body, 'sh000001');
  assert.equal(q.name, '上证指数');
  assert.equal(q.price, 3832.2624);
  assert.equal(q.prevClose, 3804.6926);
  assert.equal(q.turnover, 1187681546393);
  assert.equal(q.date, '2026-07-31');
  assert.equal(q.changePct, 0.72);
});

test('parseSinaQuote: 不存在的代码返回 null', () => {
  assert.equal(parseSinaQuote('var hq_str_sh000001="..."', 'sh999999'), null);
});

test('parseSinaQuote: 昨收为 0 时不抛除零异常，changePct=0', () => {
  const body = 'var hq_str_sz000002="测试,0,0,10,11,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-01-01,10:00:00,00,";';
  const q = parseSinaQuote(body, 'sz000002');
  assert.equal(q.changePct, 0);
});

test('parseSinaStocks: 批量解析多只个股', () => {
  const body = [
    'var hq_str_sh600988="赤峰黄金,37.600,37.170,39.560,40.790,37.500,39.560,39.570,89794883,3533710483.000,,,,,,,,";',
    'var hq_str_sh600547="山东黄金,27.000,27.500,28.200,28.500,27.800,,,,,,,,,,,,,,,";',
  ].join('\n');
  const stocks = parseSinaStocks(body);
  assert.equal(Object.keys(stocks).length, 2);
  assert.equal(stocks.sh600988.name, '赤峰黄金');
  assert.equal(stocks.sh600988.changePct, 6.43);
  assert.equal(stocks.sh600547.changePct, 2.55);
});

test('parseSinaBoard: 解析概念板块字典', () => {
  const body = 'var S_Finance_bankuai_class = {"gn_hjgn":"gn_hjgn,黄金概念,97,22.94,0.77,3.50,2777066279,55707627006,sz301013,11.835,39.500,4.180,利和兴"};';
  const boards = parseSinaBoard(body, 'S_Finance_bankuai_class');
  assert.equal(boards['黄金概念'].changePct, 3.50);
  assert.equal(boards['黄金概念'].leaderStock, '利和兴');
  assert.equal(boards['黄金概念'].turnover, 55707627006);
});

test('parseSinaBoard: JSON 格式错误返回空对象', () => {
  assert.deepEqual(parseSinaBoard('var X = {invalid', 'X'), {});
});

// ── 东方财富解析 ────────────────────────────────────────────────

test('parseMainFunds: 解析主力资金净流入与各档大单', () => {
  const text = '主力净流入：\t625.3574亿\t主力净比：\t2.46%\n超大单净流入：\t699.9381亿\t超大单净比：\t2.75%\n中单净流入：\t-506.1934亿\t中单净比：\t-1.99%';
  const f = parseMainFunds(text);
  assert.equal(f.mainNet, 625.3574);
  assert.equal(f.mainPct, 2.46);
  assert.equal(f.superLargeNet, 699.9381);
  assert.equal(f.mediumNet, -506.1934);
  assert.equal(f.mediumPct, -1.99);
});

test('parseMainFunds: 缺失字段返回 null 而非 NaN', () => {
  const f = parseMainFunds('没有任何资金数据');
  assert.equal(f.mainNet, null);
  assert.equal(f.superLargePct, null);
});

test('parseAdvanceDecline: 解析涨跌平家数', () => {
  const text = '上证 : 3832.26 ↑27.57 ↑0.72% 1.19万亿元 (涨: 1886 平: 71 跌: 392 )          深证 : ...';
  const ad = parseAdvanceDecline(text);
  assert.equal(ad.up, 1886);
  assert.equal(ad.flat, 71);
  assert.equal(ad.down, 392);
});

test('parseAdvanceDecline: 无匹配返回 null', () => {
  assert.equal(parseAdvanceDecline('页面没有涨跌家数'), null);
});

// ── 持仓股基本面 ────────────────────────────────────────────────

test('fetchStockFundamentals: 上游查询参数使用 code 而不是 stock_code', async () => {
  const previousAppCode = process.env.STOCK_FUNDAMENTALS_APP_CODE;
  process.env.STOCK_FUNDAMENTALS_APP_CODE = 'test-app-code';
  let requestedUrl = '';
  try {
    const result = await fetchStockFundamentals('002353', {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
          status: 0,
          msg: 'ok',
          result: { code: '002353', name: '测试股', list: [{ report_date: '2026-03-31' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('code'), '002353');
    assert.equal(url.searchParams.has('stock_code'), false);
    assert.equal(result.stockCode, '002353');
  } finally {
    if (previousAppCode == null) delete process.env.STOCK_FUNDAMENTALS_APP_CODE;
    else process.env.STOCK_FUNDAMENTALS_APP_CODE = previousAppCode;
  }
});

test('normalizeResponse: status=210 转成简洁的暂无数据提示', () => {
  assert.throws(
    () => normalizeResponse('600988', { status: '210', msg: '没有信息', result: '' }),
    (error) => error.statusCode === 404
      && error.unavailable === true
      && error.message === '暂无 600988 的公开财务数据（上游状态 210：没有信息）',
  );
});

test('persistFundamentals: stockCode 能正确绑定到 stock_code 写入 SQLite', () => {
  const { store, cleanup } = tempStore();
  try {
    persistFundamentals(store, {
      stockCode: '002353', stockName: '测试股', reportDate: '2026-03-31', reportType: '一季报',
      secucode: '002353.SZ', indicator: '按报告期', noticeDate: '2026-04-17', updateDate: '2026-04-17',
      metrics: {}, provider: '测试源', sourceUrl: 'https://example.test', fetchedAt: '2026-08-01T00:00:00.000Z',
    });
    const row = store.db.prepare('SELECT stock_code FROM kai_invest_stock_fundamentals WHERE stock_code = ?').get('002353');
    assert.equal(row.stock_code, '002353');
  } finally { cleanup(); }
});

test('persistFundamentals: 同一股票重复写入走 UPDATE 分支（node:sqlite 不允许多余命名参数）', () => {
  const { store, cleanup } = tempStore();
  try {
    const payload = {
      stockCode: '001270', stockName: '铖昌科技', reportDate: '2026-03-31', reportType: '一季报',
      secucode: '001270.SZ', indicator: '按报告期', noticeDate: '2026-04-28', updateDate: '2026-04-28',
      metrics: {}, provider: '测试源', sourceUrl: 'https://example.test', fetchedAt: '2026-08-01T00:00:00.000Z',
    };
    persistFundamentals(store, payload);
    // 第二次写入（已有记录 → UPDATE）不应因参数中多余的 stock_code 抛错
    const second = persistFundamentals(store, { ...payload, reportDate: '2026-06-30' });
    assert.equal(second.id, 1);
    const row = store.db.prepare('SELECT report_date FROM kai_invest_stock_fundamentals WHERE stock_code = ?').get('001270');
    assert.equal(row.report_date, '2026-06-30');
  } finally { cleanup(); }
});

test('operation log: 任务状态、耗时与详情可持久化并筛选', () => {
  const { store, cleanup } = tempStore();
  try {
    const started = store.startOperation({
      category: 'collection',
      operationKey: 'test-market',
      title: '测试行情采集',
      summary: '正在采集',
      metadata: { scope: 'market' },
      startedAt: '2026-08-01T00:00:00.000Z',
    });
    assert.equal(started.status, 'running');
    const finished = store.finishOperation(started.id, {
      status: 'success',
      summary: '采集完成',
      details: '已写入 1 条市场记录',
      finishedAt: '2026-08-01T00:00:01.250Z',
    });
    assert.equal(finished.status, 'success');
    assert.equal(finished.duration_ms, 1250);
    assert.equal(finished.metadata.scope, 'market');
    assert.equal(store.listOperationLogs({ category: 'collection' }).length, 1);
    assert.equal(store.listOperationLogs({ status: 'failed' }).length, 0);
  } finally { cleanup(); }
});

// ── 持仓更新与变更记录 ──────────────────────────────────────────

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-test-'));
  const store = new InvestmentStore(path.join(dir, 't.sqlite'));
  return { store, cleanup: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function makeHolding(store, overrides = {}) {
  return store.create('portfolio', {
    list_type: 'holding',
    stock_name: '测试股',
    stock_code: '000001',
    cost_price: 10,
    quantity: 100,
    cost_basis: 0,
    action_level: '观察',
    ...overrides,
  });
}

test('updateHoldingWithChange: 数量变化必须填写变更原因', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store);
    assert.throws(
      () => store.updateHoldingWithChange(h.id, { quantity: 200 }),
      /变更原因/,
    );
    // 数量不变时不需要原因
    const r = store.updateHoldingWithChange(h.id, { quantity: 100, trend: '上升' });
    assert.equal(r.holding.trend, '上升');
    assert.equal(r.change, null);
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 加仓自动生成变更记录（原数量 → 新数量）', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store, { quantity: 100, cost_price: 100 });
    const r = store.updateHoldingWithChange(h.id, { quantity: 150, cost_price: 150, price: 120, change_reason: '逻辑未破坏，加仓 50 股' });
    assert.equal(r.holding.quantity, 150);
    assert.equal(r.holding.cost_price, 150);
    assert.equal(r.change.trade_type, '加仓');
    assert.equal(r.change.before_quantity, 100);
    assert.equal(r.change.after_quantity, 150);
    assert.equal(r.change.quantity, 50);
    assert.equal(r.change.price, 120, '成交价应取本次传入');
    assert.equal(r.change.amount, 6000, 'amount 应由 price*|quantity| 兜底计算（120*50）');
    assert.equal(r.change.reason, '逻辑未破坏，加仓 50 股');
    assert.equal(store.list('trades').length, 1);
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 减仓自动生成变更记录', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store, { quantity: 100 });
    const r = store.updateHoldingWithChange(h.id, { quantity: 40, change_reason: '达到止盈条件，减仓' });
    assert.equal(r.change.trade_type, '减仓');
    assert.equal(r.change.before_quantity, 100);
    assert.equal(r.change.after_quantity, 40);
    assert.equal(r.change.quantity, 60);
    assert.equal(store.get('portfolio', h.id).quantity, 40);
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 未传 price 时用 cost_price 兜底成交价与金额', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store, { quantity: 100, cost_price: 25 });
    const r = store.updateHoldingWithChange(h.id, { quantity: 60, change_reason: '减仓 40 股' });
    assert.equal(r.change.price, 25, '未传 price 时应回退到持仓成本价');
    assert.equal(r.change.amount, 1000, 'amount = cost_price * |delta| = 25 * 40');
  } finally { cleanup(); }
});

test('trades: 显式 amount 不被 price*quantity 覆盖，amount:0 保留', () => {
  const { store, cleanup } = tempStore();
  try {
    // 显式提供 amount：不应被兜底计算覆盖
    const t1 = store.create('trades', { stock_name: '测试', price: 10, quantity: 100, amount: 999 });
    assert.equal(t1.amount, 999, '显式 amount 应保留');
    // 显式 amount:0（如分红入账）：不应被误算成 price*quantity
    const t2 = store.create('trades', { stock_name: '分红', price: 10, quantity: 100, amount: 0 });
    assert.equal(t2.amount, 0, '显式 amount:0 应保留，不被兜底计算');
    // 未提供 amount：应兜底计算
    const t3 = store.create('trades', { stock_name: '自动', price: 8, quantity: 50 });
    assert.equal(t3.amount, 400, '未提供 amount 时应 = price*|quantity|');
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 数量归零视为清仓，可恢复持仓', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store, { quantity: 100 });
    const r = store.updateHoldingWithChange(h.id, { quantity: 0, change_reason: '买入逻辑破坏，清仓' });
    assert.equal(r.change.trade_type, '卖出');
    assert.equal(r.holding.quantity, 0);
    assert.ok(r.holding.closed_at);
    assert.equal(r.holding.action_level, '退出');
    // 从 0 恢复为持有
    const r2 = store.updateHoldingWithChange(h.id, { quantity: 200, change_reason: '重新看好，买入 200 股' });
    assert.equal(r2.change.trade_type, '买入');
    assert.equal(r2.holding.closed_at, '');
    assert.equal(r2.holding.action_level, '观察');
    assert.equal(r2.change.before_quantity, 0);
    assert.equal(r2.change.after_quantity, 200);
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 数量不变只更新其他字段，不产生记录', () => {
  const { store, cleanup } = tempStore();
  try {
    const h = makeHolding(store, { quantity: 100, cost_price: 100 });
    const r = store.updateHoldingWithChange(h.id, { quantity: 100, cost_price: 120, thesis_status: '未破坏' });
    assert.equal(r.holding.cost_price, 120);
    assert.equal(r.change, null);
    assert.equal(store.list('trades').length, 0);
  } finally { cleanup(); }
});

test('updateHoldingWithChange: 关注列表更新不走变更记录', () => {
  const { store, cleanup } = tempStore();
  try {
    const w = store.create('portfolio', { list_type: 'watch', stock_name: '观察股', buy_logic: '关注' });
    const r = store.updateHoldingWithChange(w.id, { watch_condition: '放量突破' });
    assert.equal(r.change, null);
    assert.equal(r.holding.watch_condition, '放量突破');
  } finally { cleanup(); }
});

// ── store 校验逻辑 ──────────────────────────────────────────────

test('decisions: review_outcome 非法值回退为 pending', () => {
  const { store, cleanup } = tempStore();
  try {
    const d = store.create('decisions', { title: '测试', review_outcome: 'totally-wrong' });
    assert.equal(d.review_outcome, 'pending');
  } finally { cleanup(); }
});

test('sectors: rating 被 clamp 到 1-5', () => {
  const { store, cleanup } = tempStore();
  try {
    const s = store.create('sectors', { name: '测试板块', rating: 99 });
    assert.equal(s.rating, 5);
    const s2 = store.create('sectors', { name: '测试板块2', rating: -3 });
    assert.equal(s2.rating, 1);
  } finally { cleanup(); }
});

test('market: record_type 非法值回退为 market', () => {
  const { store, cleanup } = tempStore();
  try {
    const m = store.create('market', { name: '测试', record_type: 'unknown' });
    assert.equal(m.record_type, 'market');
  } finally { cleanup(); }
});

test('decisionReviewStats: 加权命中率正确=1，部分=0.5', () => {
  const { store, cleanup } = tempStore();
  try {
    const today = new Date().toISOString().slice(0, 10);
    store.create('decisions', { title: '对', decision_date: today, review_outcome: 'correct' });
    store.create('decisions', { title: '部分', decision_date: today, review_outcome: 'partial' });
    store.create('decisions', { title: '错', decision_date: today, review_outcome: 'wrong' });
    store.create('decisions', { title: '待复盘', decision_date: today, review_outcome: 'pending' });
    const s = store.decisionReviewStats();
    // (1 correct + 0.5 partial) / 3 reviewed = 50%
    assert.equal(s.correct, 1);
    assert.equal(s.partial, 1);
    assert.equal(s.wrong, 1);
    assert.equal(s.pending, 1);
    assert.equal(s.hitRate, 50);
    assert.equal(s.reviewRate, 75);
  } finally { cleanup(); }
});

// ── 定时任务调度器 ─────────────────────────────────────────────
const { TaskScheduler, nextDailyAt } = require('../../scripts/task-scheduler.cjs');

test('TaskScheduler: interval 任务启动即运行、到间隔再运行', () => {
  let now = new Date('2026-08-03T09:00:00+08:00');
  const s = new TaskScheduler({ tasks: [{ key: 'p', intervalMs: 15 * 60 * 1000 }], now: () => now });
  assert.equal(s.isDue(s.tasks[0], now), true); // 从未运行 → 启动即跑
  s.tasks[0].lastRunAt = now.toISOString();
  assert.equal(s.isDue(s.tasks[0], now), false); // 刚运行过
  now = new Date('2026-08-03T09:16:00+08:00');
  assert.equal(s.isDue(s.tasks[0], now), true); // 超过 15 分钟
});

test('TaskScheduler: daily 任务按工作日计划、启动补跑、当天不重复', () => {
  const task = { key: 'c', hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5] };
  // 周六（08-01）到点也不触发
  let now = new Date('2026-08-01T16:30:00+08:00');
  let s = new TaskScheduler({ tasks: [task], now: () => now });
  assert.equal(s.isDue(s.tasks[0], now), false);
  // 周一（08-03）已过计划时刻且从未运行 → 启动补跑
  now = new Date('2026-08-03T16:30:00+08:00');
  s = new TaskScheduler({ tasks: [task], now: () => now });
  assert.equal(s.isDue(s.tasks[0], now), true);
  // 今天已跑过 → 不重复
  s.tasks[0].lastRunAt = new Date('2026-08-03T16:12:00+08:00').toISOString();
  assert.equal(s.isDue(s.tasks[0], now), false);
  // 周一计划时刻之前 → 不触发
  now = new Date('2026-08-03T10:00:00+08:00');
  s = new TaskScheduler({ tasks: [task], now: () => now });
  assert.equal(s.isDue(s.tasks[0], now), false);
  // 周二（08-04）16:10 后 → 触发
  now = new Date('2026-08-04T16:30:00+08:00');
  s = new TaskScheduler({ tasks: [task], now: () => now });
  assert.equal(s.isDue(s.tasks[0], now), true);
});

test('TaskScheduler: 失败任务在30分钟后重试，成功后重试计数归零', async () => {
  const task = { key: 'r', hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5] };
  let now = new Date('2026-08-03T16:12:00+08:00'); // 周一刚过计划点
  const s = new TaskScheduler({ tasks: [task], now: () => now });
  task.run = async () => ({ ok: false, summary: '采集失败' });
  await s.runTask(task);
  assert.equal(task.lastStatus, 'failed');
  assert.equal(task.retryCount, 1, '失败后 retryCount 应为 1');
  // 失败后立即检查：未满 30 分钟，不触发重试
  assert.equal(s.isDue(task, now), false);
  // 30 分钟后 → 触发重试
  now = new Date('2026-08-03T16:43:00+08:00');
  assert.equal(s.isDue(task, now), true);
  // 重试成功 → retryCount 归零
  task.run = async () => ({ ok: true, summary: '完成' });
  await s.runTask(task);
  assert.equal(task.lastStatus, 'success');
  assert.equal(task.retryCount, 0, '成功后 retryCount 应归零');
});

test('TaskScheduler: 达最大重试次数后当日不再重试', async () => {
  const task = { key: 'm', hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5] };
  let now = new Date('2026-08-03T16:12:00+08:00');
  const s = new TaskScheduler({ tasks: [task], now: () => now });
  task.run = async () => ({ ok: false, summary: '持续失败' });
  // 跑满 MAX_RETRIES+1 次（初次 + 2 次重试）
  for (let i = 0; i < 3; i++) {
    await s.runTask(task);
    now = new Date('2026-08-03T17:00:00+08:00'); // 推进到重试间隔之后
  }
  assert.equal(task.retryCount, 3, '应已重试 3 次');
  // 达到上限后，即使过了 30 分钟也不再触发
  now = new Date('2026-08-03T23:00:00+08:00');
  assert.equal(s.isDue(task, now), false, '达最大重试次数后当日不再触发');
});

test('TaskScheduler: 崩溃恢复——当天计划点已过但今天没跑过则补采', () => {
  const task = { key: 'cr', hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5] };
  // 周一 18:00，但 lastRunAt 是昨天（周日，非计划日）→ 今天还没跑过 → 补采
  const now = new Date('2026-08-03T18:00:00+08:00');
  const s = new TaskScheduler({ tasks: [task], now: () => now });
  task.lastRunAt = new Date('2026-08-02T18:00:00+08:00').toISOString(); // 昨天跑过
  task.lastStatus = 'success';
  assert.equal(s.isDue(task, now), true, '今天计划点已过但今天没跑过应补采');
});

test('nextDailyAt: 周五收盘后跨到下一工作日，当天未到点则取当天', () => {
  const task = { hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5] };
  // 周五（08-07）17:00 → 下周一（08-10）16:10
  const next = nextDailyAt(task, new Date('2026-08-07T17:00:00+08:00'));
  assert.equal(next.toISOString(), new Date('2026-08-10T16:10:00+08:00').toISOString());
  // 周一 10:00 → 当天 16:10
  const same = nextDailyAt(task, new Date('2026-08-03T10:00:00+08:00'));
  assert.equal(same.toISOString(), new Date('2026-08-03T16:10:00+08:00').toISOString());
});

test('nextDailyAt: 排除节假日（春节长假）后跨到节后第一个交易日', () => {
  const task = {
    hour: 16, minute: 10, weekdays: [1, 2, 3, 4, 5],
    excludedDates: ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23'],
  };
  // 春节前最后一个周六（02-14）→ 跳过春节休市，落在节后首个交易日 02-24（周二）
  const next = nextDailyAt(task, new Date('2026-02-14T12:00:00+08:00'));
  assert.equal(next.toISOString(), new Date('2026-02-24T16:10:00+08:00').toISOString());
  // 休市中的工作日 02-18 不应是计划日
  const plan = require('../../scripts/task-scheduler.cjs').todayPlanAt(task, new Date('2026-02-18T10:00:00+08:00'));
  assert.equal(plan, null);
  // 节后首日 02-24 恢复计划
  const plan2 = require('../../scripts/task-scheduler.cjs').todayPlanAt(task, new Date('2026-02-24T10:00:00+08:00'));
  assert.equal(plan2.toISOString(), new Date('2026-02-24T16:10:00+08:00').toISOString());
});

// ── A 股交易日历 ─────────────────────────────────────────────
const tradingCalendar = require('../../scripts/trading-calendar.cjs');

test('trading-calendar: 2026 年节假日休市与普通交易日判断', () => {
  const cases = [
    ['2026-01-01', false], // 元旦
    ['2026-01-02', false],
    ['2026-01-05', true],  // 节后首个交易日
    ['2026-02-16', false], // 春节休市
    ['2026-02-23', false],
    ['2026-02-24', true],  // 节后首个交易日
    ['2026-04-06', false], // 清明
    ['2026-05-01', false], // 劳动节
    ['2026-05-05', false],
    ['2026-06-19', false], // 端午
    ['2026-09-25', false], // 中秋
    ['2026-10-01', false], // 国庆
    ['2026-10-07', false],
    ['2026-10-08', true],
    ['2026-08-01', false], // 周六
    ['2026-08-02', false], // 周日
    ['2026-08-03', true],  // 周一
    ['2026-08-05', true],  // 普通周三
  ];
  for (const [key, want] of cases) {
    assert.equal(tradingCalendar.isTradingDay(new Date(`${key}T10:00:00`)), want, key);
  }
});

test('trading-calendar: nextTradingDay 跳过周末与节假日', () => {
  assert.equal(
    tradingCalendar.nextTradingDayKey(new Date('2026-08-02T10:00:00')),
    '2026-08-03',
  );
  // 春节假期前最后一个周末 02-14（周六）→ 跳过整个春节休市
  assert.equal(
    tradingCalendar.nextTradingDayKey(new Date('2026-02-14T10:00:00')),
    '2026-02-24',
  );
  // 交易日当天 → 当天
  assert.equal(
    tradingCalendar.nextTradingDayKey(new Date('2026-08-05T10:00:00')),
    '2026-08-05',
  );
});

test('trading-calendar: 年份超出覆盖范围时按工作日判定（告警后降级）', () => {
  tradingCalendar._resetCoverageWarned();
  // 2027 年元旦（周五）若休市数据未补充，会被降级判为交易日（已告警）
  const future = tradingCalendar.isTradingDay(new Date('2027-01-04T10:00:00')); // 周一
  assert.equal(future, true, '覆盖范围外的工作日应按交易日判定（降级）');
  // 2027 年的周末仍应排除
  const weekend = tradingCalendar.isTradingDay(new Date('2027-01-09T10:00:00')); // 周六
  assert.equal(weekend, false, '周末仍应排除');
  assert.ok(tradingCalendar.CALENDAR_COVERAGE_YEAR >= 2026, '覆盖年份常量存在');
});

// ── 字段写权限（AGENTS.md §2.1：collect / analyze / manual）────────────────

test('write rules: analyze 写 market 判断字段成功，原始数据字段被拒绝', () => {
  const { store, cleanup } = tempStore();
  try {
    const market = store.create('market', {
      record_type: 'market', name: 'A股市场环境', status: '已更新',
      current_value: '汇总', metrics_json: { indexTrend: { sh: { price: 3800 } } },
      observed_at: '2026-08-01',
    });
    const updated = store.update('market', market.id, {
      score: 4, risk_level: 3, opportunity_level: 4, strategy: '等待主线确认',
      analysis_source: 'AI · test', analyzed_at: '2026-08-02T10:00:00.000Z',
    }, { source: 'analyze' });
    assert.equal(updated.score, 4);
    assert.equal(updated.metrics.indexTrend.sh.price, 3800, '分析不应改动原始行情');
    assert.equal(updated.observed_at, '2026-08-01');
    assert.throws(
      () => store.update('market', market.id, { metrics_json: {} }, { source: 'analyze' }),
      /写入越界/,
    );
    assert.throws(
      () => store.update('market', market.id, { observed_at: '2026-08-02' }, { source: 'analyze' }),
      /写入越界/,
    );
    assert.throws(
      () => store.update('market', market.id, { status: '已更新' }, { source: 'analyze' }),
      /写入越界/,
    );
  } finally { cleanup(); }
});

test('write rules: collect 写 market 被禁止判断字段（score/risk_level/strategy/rationale）', () => {
  const { store, cleanup } = tempStore();
  try {
    const market = store.create('market', {
      record_type: 'market', name: 'A股市场环境', status: '已更新',
      current_value: '汇总', observed_at: '2026-08-01',
    });
    // collect 可写客观行情字段
    const ok = store.update('market', market.id, {
      current_value: '上证 3800', change_note: '收盘', metrics_json: { a: 1 }, observed_at: '2026-08-02', status: '已更新',
    }, { source: 'collect' });
    assert.equal(ok.current_value, '上证 3800');
    // collect 不可写任何判断字段（§2.1 收紧后）
    assert.throws(() => store.update('market', market.id, { score: 3 }, { source: 'collect' }), /写入越界/);
    assert.throws(() => store.update('market', market.id, { risk_level: 2 }, { source: 'collect' }), /写入越界/);
    assert.throws(() => store.update('market', market.id, { opportunity_level: 4 }, { source: 'collect' }), /写入越界/);
    assert.throws(() => store.update('market', market.id, { strategy: '观望' }, { source: 'collect' }), /写入越界/);
    assert.throws(() => store.update('market', market.id, { rationale: '来源说明' }, { source: 'collect' }), /写入越界/);
  } finally { cleanup(); }
});

test('write rules: collect 写 sectors 只允许行情字段，analyze 只允许参考分析字段', () => {
  const { store, cleanup } = tempStore();
  try {
    const sector = store.create('sectors', { name: '黄金', rating: 4, status: '观察', logic: '央行购金', risks: '美元反弹' });
    const updated = store.update('sectors', sector.id, {
      indicators: JSON.stringify({ changePct: 1.2 }),
      updated_note: '2026-08-02 更新',
    }, { source: 'collect' });
    assert.equal(updated.indicators.includes('changePct'), true);
    assert.equal(updated.rating, 4, '采集不应改动评级');
    assert.throws(
      () => store.update('sectors', sector.id, { rating: 5 }, { source: 'collect' }),
      /写入越界/,
    );
    assert.throws(
      () => store.update('sectors', sector.id, { logic: '改逻辑' }, { source: 'collect' }),
      /写入越界/,
    );
    store.update('sectors', sector.id, {
      analysis_note: JSON.stringify({ summary: '参考' }), analysis_source: 'AI · test', analyzed_at: '2026-08-02T10:00:00.000Z',
    }, { source: 'analyze' });
    assert.throws(
      () => store.update('sectors', sector.id, { rating: 1 }, { source: 'analyze' }),
      /写入越界/,
    );
    assert.throws(
      () => store.update('sectors', sector.id, { status: '退出' }, { source: 'analyze' }),
      /写入越界/,
    );
    // 人工可写全部字段（看板编辑与「采纳建议」路径）
    const manual = store.update('sectors', sector.id, { rating: 5, status: '重仓跟踪', logic: '人工更新' }, { source: 'manual' });
    assert.equal(manual.rating, 5);
    assert.equal(manual.logic, '人工更新');
  } finally { cleanup(); }
});

test('write rules: 未知来源被拒绝，持仓/交易表只允许人工写入', () => {
  const { store, cleanup } = tempStore();
  try {
    const holding = makeHolding(store);
    const sector = store.create('sectors', { name: '猪肉' });
    assert.throws(
      () => store.update('portfolio', holding.id, { buy_logic: 'x' }, { source: 'collect' }),
      /无权修改资源 portfolio/,
    );
    assert.throws(
      () => store.update('sectors', sector.id, { rating: 1 }, { source: 'hacker' }),
      /无权修改资源 sectors/,
    );
    assert.throws(
      () => store.create('portfolio', { stock_name: '测试' }, { source: 'analyze' }),
      /无权修改资源 portfolio/,
    );
    // 默认 source 为 manual（兼容看板与内部调用）
    const ok = store.update('portfolio', holding.id, { watch_condition: '跌破关键位' });
    assert.equal(ok.watch_condition, '跌破关键位');
  } finally { cleanup(); }
});

// ── 黄金行情写库（AGENTS.md §2.1：collect 必须显式传 source，且不可写 rationale）──

test('syncGoldMacro: 以 source=collect 写入黄金变量，且不携带越界的 rationale 字段', () => {
  const { syncGoldMacro } = require('../../gold-market.cjs');
  const { store, cleanup } = tempStore();
  try {
    const marketData = {
      provider: '阿里云云市场 · 探数API',
      market: '上海黄金交易所',
      sourceUrl: 'https://example.com',
      primarySymbol: 'Au9999',
      marketUpdatedAt: '2026-08-02 14:30:00',
      fetchedAt: '2026-08-02T06:30:00.000Z',
      quotes: [
        { symbol: 'Au9999', name: '黄金9999', price: 555.5, changePercent: 0.82, high: 558, low: 552, unit: '元/克', updatedAt: '2026-08-02 14:30:00' },
      ],
    };
    const created = syncGoldMacro(store, marketData);
    assert.equal(created.name, '黄金变量');
    assert.equal(created.record_type, 'macro');
    assert.equal(created.current_value.includes('555.50'), true);
    assert.equal(created.current_value.includes('元/克'), true);
    assert.equal(created.change_note.includes('来源'), true, '来源说明应落在 collect 可写的 change_note');
    assert.equal(created.change_note.includes('+0.82%'), true);
    assert.equal(created.rationale, '', 'rationale 属判断字段，collect 不得写入');
    assert.equal(created.observed_at, '2026-08-02 14:30:00');

    // 第二次调用应走 update（existing 分支），同样不得引入 rationale
    marketData.quotes[0].price = 560;
    marketData.quotes[0].changePercent = 1.5;
    const updated = syncGoldMacro(store, marketData);
    assert.equal(updated.id, created.id, '应原地更新同一条记录');
    assert.equal(updated.current_value.includes('560.00'), true);
    assert.equal(updated.rationale, '', 'update 路径同样不得写 rationale');
  } finally { cleanup(); }
});

// ── 每日复盘写权限（§2.1：仅人工，AI 不得代填）──────────────────────────────

test('saveDailyReview: 仅允许人工来源，AI/collect 被拒绝', () => {
  const { store, cleanup } = tempStore();
  try {
    // 默认（manual）可写
    const r = store.saveDailyReview({ review_date: '2026-08-02', status: 'in_progress', current_step: 1 });
    assert.equal(r.review_date, '2026-08-02');
    assert.equal(r.status, 'in_progress');
    // 显式 manual 可写
    store.saveDailyReview({ review_date: '2026-08-02', summary_note: '测试' }, { source: 'manual' });
    // AI/collect 被拒绝
    assert.throws(
      () => store.saveDailyReview({ review_date: '2026-08-03' }, { source: 'analyze' }),
      /仅允许人工写入/,
    );
    assert.throws(
      () => store.saveDailyReview({ review_date: '2026-08-03' }, { source: 'collect' }),
      /仅允许人工写入/,
    );
  } finally { cleanup(); }
});

// ── 本地鉴权：写操作的 Origin/Host 校验（防 DNS rebinding / 跨站）──────────────
const { checkLocalOrigin } = require('../../serve.cjs');

test('checkLocalOrigin: 本机 Host/Origin 通过，跨站被拒', () => {
  // 本机 Host + 无 Origin → 通过
  assert.equal(checkLocalOrigin({ headers: { host: '127.0.0.1:4173' } }), null);
  assert.equal(checkLocalOrigin({ headers: { host: 'localhost:4174' } }), null);
  // 本机 Host + 本机 Origin → 通过
  assert.equal(checkLocalOrigin({ headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' } }), null);
  // 跨站 Origin → 拒绝（DNS rebinding / 钓鱼页场景）
  assert.ok(checkLocalOrigin({ headers: { host: '127.0.0.1:4173', origin: 'http://evil.com' } })?.includes('非法 Origin'));
  // 非 localhost 的 Host → 拒绝
  assert.ok(checkLocalOrigin({ headers: { host: 'evil.com:4173' } })?.includes('非法 Host'));
  // 缺 Host → 拒绝
  assert.ok(checkLocalOrigin({ headers: {} })?.includes('非法 Host'));
});
