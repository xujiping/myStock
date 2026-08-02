#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InvestmentStore } = require('../investment-store.cjs');
const {
  normalizeGoldResponse,
  syncGoldMacro,
} = require('../gold-market.cjs');
const {
  buildOverview,
  createDailyAnalysis,
  getVideoResearchLibrary,
} = require('../investment-analysis.cjs');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-invest-check-'));
  const databasePath = path.join(tempDir, 'check.sqlite');
  const store = new InvestmentStore(databasePath);

  try {
    const tables = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kai_invest_%' ORDER BY name",
    ).all().map((item) => item.name);
    assert.deepEqual(tables, [
      'kai_invest_daily_review',
      'kai_invest_decision',
      'kai_invest_market',
      'kai_invest_operation_log',
      'kai_invest_portfolio',
      'kai_invest_sector',
      'kai_invest_stock_fundamentals',
      'kai_invest_stock_quote',
      'kai_invest_trade_log',
    ]);

    const holding = store.create('portfolio', {
      list_type: 'holding',
      stock_name: '自检标的',
      stock_code: '000001',
      cost_price: 10,
      cost_amount: 1000,
      quantity: 100,
      position_pct: 5,
      buy_logic: '验证数据模型',
      thesis_status: '未破坏',
      action_level: '持有',
    });
    assert.equal(holding.stock_name, '自检标的');

    const updated = store.update('portfolio', holding.id, { watch_condition: '跌破关键位置并放量' });
    assert.equal(updated.list_type, 'holding');
    assert.equal(updated.watch_condition, '跌破关键位置并放量');

    const overview = buildOverview(store);
    assert.equal(overview.holdings.length, 1);
    // 仓位自动计算：成本价格 10 × 数量 100 = 1000，单只占总成本 1000 = 100%（传入的 position_pct: 5 应被忽略）
    assert.equal(overview.holdings[0].position_pct, 100);
    // 多只持仓按成本价格 × 数量占比分摊（30 × 100 = 3000）
    const second = store.create('portfolio', {
      list_type: 'holding',
      stock_name: '自检标的二',
      stock_code: '000002',
      cost_price: 30,
      quantity: 100,
      buy_logic: '验证仓位分摊',
    });
    const overview2 = buildOverview(store);
    const pctByCode = new Map(overview2.holdings.map((item) => [item.stock_code, item.position_pct]));
    assert.equal(pctByCode.get('000001'), 25);
    assert.equal(pctByCode.get('000002'), 75);
    store.delete('portfolio', second.id);
    // 行情装配：写入行情快照后，持仓应带出最新价与浮盈率（最新价 12 - 成本价 10 = +20%）
    store.saveQuotes([{ stock_code: '000001', stock_name: '自检标的', price: 12, change_pct: 2.5 }]);
    const overviewWithQuote = buildOverview(store);
    assert.equal(overviewWithQuote.holdings[0].latestPrice, 12);
    assert.equal(overviewWithQuote.holdings[0].pnlPct, 20);
    assert.equal(overviewWithQuote.holdings[0].quoteChangePct, 2.5);
    assert.equal(store.listQuotes().length, 1);
    assert.ok(overview.videoEvidence.totalVideos >= 0);
    assert.ok(overview.judgment.evidenceSources.some((item) => item.key === 'video'));
    assert.ok(Array.isArray(overview.judgment.reviewTasks));
    assert.ok(overview.judgment.completenessChecks.every((item) => Number.isFinite(item.score)));
    // 交易日历随总览返回（today 为布尔、next 为 YYYY-MM-DD）
    assert.equal(typeof overview.tradingDay.today, 'boolean');
    assert.match(overview.tradingDay.next, /^\d{4}-\d{2}-\d{2}$/);

    // 决策复盘结论与命中率统计
    const reviewedDecision = store.create('decisions', {
      title: '自检判断',
      decision_date: '2026-07-31',
      review_outcome: 'correct',
      review_result: '判断兑现',
    });
    assert.equal(reviewedDecision.review_outcome, 'correct');
    const invalidOutcome = store.create('decisions', { title: '非法值', review_outcome: 'bogus' });
    assert.equal(invalidOutcome.review_outcome, 'pending');
    const stats = store.decisionReviewStats();
    assert.ok(stats.correct >= 1, '应至少统计到 1 条正确');
    assert.ok(Number.isFinite(stats.hitRate), '命中率应为数值');
    store.delete('decisions', reviewedDecision.id);
    store.delete('decisions', invalidOutcome.id);

    const startedReview = store.saveDailyReview({
      review_date: '2026-07-31',
      status: 'in_progress',
      current_step: 2,
      items: [{
        key: 'holding-check',
        title: '确认持仓逻辑',
        detail: '检查买入依据是否变化',
        tone: 'pending',
        sourceLabel: '我的持仓',
        sourcePage: 'holdings',
        status: 'done',
        note: '已核对',
      }],
    });
    assert.equal(startedReview.current_step, 2);
    assert.equal(startedReview.items[0].status, 'done');
    const completedReview = store.saveDailyReview({
      review_date: '2026-07-31',
      status: 'completed',
      current_step: 3,
      items: startedReview.items,
      summary_note: '按计划执行',
    });
    assert.equal(completedReview.status, 'completed');
    assert.ok(completedReview.completed_at);
    assert.equal(store.listDailyReviews(7).length, 1);

    const goldMarket = normalizeGoldResponse({
      code: 1,
      msg: '操作成功',
      data: {
        list: {
          Au9999: {
            typename: '黄金9999',
            price: '888.80',
            changequantity: '8.80',
            changepercent: '1.00%',
            maxprice: '890.00',
            minprice: '880.00',
            unit: '元/克',
            updatetime: '2026-07-31 09:30:00',
          },
        },
      },
    });
    const goldMacro = syncGoldMacro(store, goldMarket);
    assert.equal(goldMarket.primarySymbol, 'Au9999');
    assert.equal(goldMacro.name, '黄金变量');
    assert.equal(goldMacro.status, '上涨');
    assert.equal(goldMacro.metrics.primarySymbol, 'Au9999');

    const videoLibrary = getVideoResearchLibrary();
    assert.equal(videoLibrary.videos.length, videoLibrary.totalVideos);
    if (videoLibrary.videos.length > 1) {
      assert.ok(videoLibrary.videos[0].date >= videoLibrary.videos.at(-1).date);
    }
    if (videoLibrary.videos.length) {
      assert.ok(Object.hasOwn(videoLibrary.videos[0], 'transcript'));
      assert.ok(Array.isArray(videoLibrary.videos[0].viewpoints));
    }

    const daily = await createDailyAnalysis(store, { forceRules: true });
    assert.equal(daily.mode, '规则辅助');
    assert.ok(daily.report.title.includes('投资日报'));
    assert.ok(!daily.report.action.includes('[object Object]'));

    // 持仓更新闭环：数量变化必须填原因，自动生成变更记录；清仓自动归档，可恢复
    const partial = store.updateHoldingWithChange(holding.id, {
      trade_date: '2026-07-31',
      quantity: 60,
      change_reason: '验证减仓闭环',
    });
    assert.equal(partial.change.trade_type, '减仓');
    assert.equal(partial.change.before_quantity, 100);
    assert.equal(partial.change.after_quantity, 60);
    assert.equal(store.get('portfolio', holding.id).quantity, 60);
    assert.equal(store.list('trades')[0].portfolio_id, holding.id);
    assert.equal(store.list('trades')[0].reason, '验证减仓闭环');

    const full = store.updateHoldingWithChange(holding.id, {
      trade_date: '2026-07-31',
      quantity: 0,
      change_reason: '验证清仓归档',
    });
    assert.equal(full.change.trade_type, '卖出');
    assert.equal(full.change.after_quantity, 0);
    assert.equal(store.get('portfolio', holding.id).closed_at, '2026-07-31');
    assert.equal(buildOverview(store).holdings.length, 0);

    store.delete('portfolio', holding.id);
    assert.equal(store.list('portfolio').length, 0);

    // 看板 HTML 与外链 dashboard.js 共同构成前端，字符串检查需覆盖两者
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'investment-dashboard.html'), 'utf8');
    const dashboardJsPath = path.join(__dirname, '..', 'dashboard.js');
    const dashboardJs = fs.existsSync(dashboardJsPath) ? fs.readFileSync(dashboardJsPath, 'utf8') : '';
    const dashboard = dashboardHtml + '\n' + dashboardJs;
    assert.ok(!dashboardHtml.includes('href="/legacy/'));
    assert.ok(dashboard.includes('data-video-date='));
    assert.ok(dashboard.includes('target="_blank" rel="noopener">原视频'));
    assert.ok(dashboard.includes('data-refresh-gold'));
    assert.ok(dashboard.includes('/api/investment/gold/refresh'));
    assert.ok(dashboard.includes('/api/investment/daily-review'));
    assert.ok(dashboard.includes('开始今日复盘'));
    assert.ok(dashboard.includes('完成今日复盘'));
    assert.ok(dashboard.includes('change_reason'));
    assert.ok(dashboard.includes('/api/investment/portfolio'));
    assert.ok(dashboardHtml.includes('<script src="/dashboard.js"></script>'), '看板应外链 dashboard.js');
    assert.ok(dashboardJs, 'dashboard.js 应存在');
    // dashboard.js 语法检查（拆分后不再有内联 script）
    new Function(dashboardJs);

    console.log('检查通过：9 张前缀表、CRUD、运行日志、今日复盘、持仓变更闭环、总览聚合、黄金行情、规则日报、视频证据和页面脚本');
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`检查失败：${error.stack || error.message}`);
  process.exit(1);
});
