const fs = require('node:fs');
const path = require('node:path');
const { localDate } = require('./investment-store.cjs');
const { isTradingDay, nextTradingDayKey } = require('./scripts/trading-calendar.cjs');
const { readFundamentalsRows } = require('./stock-fundamentals.cjs');

const ROOT = __dirname;
const VIDEO_DATA_PATH = path.join(ROOT, 'reports', 'data.json');

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readVideoData() {
  try {
    return JSON.parse(fs.readFileSync(VIDEO_DATA_PATH, 'utf8'));
  } catch {
    return { generatedAt: null, videos: [] };
  }
}

function summarizeVideoEvidence(limit = 8) {
  const data = readVideoData();
  const videos = Array.isArray(data.videos) ? data.videos : [];
  const sectorMap = new Map();
  for (const video of videos) {
    for (const view of video.analysis?.sectorViews || []) {
      const current = sectorMap.get(view.sector) || {
        sector: view.sector,
        mentionCount: 0,
        score: 0,
        bullish: 0,
        cautious: 0,
        watch: 0,
        quotes: [],
        dates: [],
      };
      current.mentionCount += 1;
      current.score += Number(view.score) || 0;
      if (view.direction === '看涨') current.bullish += 1;
      else if (view.direction === '偏谨慎') current.cautious += 1;
      else current.watch += 1;
      current.quotes.push(...(view.quotes || []).slice(0, 2));
      current.dates.push(video.date);
      sectorMap.set(view.sector, current);
    }
  }

  const sectors = [...sectorMap.values()]
    .map((item) => ({
      ...item,
      direction: item.score > 0 ? '偏积极' : item.score < 0 ? '偏谨慎' : '观察',
      quotes: unique(item.quotes).slice(0, 3),
      latestDate: item.dates.sort().at(-1) || '',
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount || Math.abs(b.score) - Math.abs(a.score));

  return {
    generatedAt: data.generatedAt,
    totalVideos: videos.length,
    latestDate: videos.map((video) => video.date).sort().at(-1) || '',
    sectors,
    recentVideos: videos.slice(0, limit).map((video) => ({
      id: video.id,
      name: video.name,
      date: video.date,
      summary: (video.summary || video.analysis?.relevant || []).slice(0, 5),
      stocks: video.analysis?.stocks || [],
      sectorViews: video.analysis?.sectorViews || [],
    })),
  };
}

function getVideoResearchLibrary() {
  const data = readVideoData();
  const videos = Array.isArray(data.videos) ? data.videos : [];
  const evidence = summarizeVideoEvidence(0);

  return {
    generatedAt: data.generatedAt,
    totalVideos: videos.length,
    latestDate: evidence.latestDate,
    sectors: evidence.sectors,
    videos: videos
      .map((video) => ({
        id: video.id,
        name: video.name,
        date: video.date,
        transcript: video.transcript || '',
        viewpoints: unique(
          (video.summary || []).length
            ? video.summary
            : (video.analysis?.views || video.analysis?.relevant || []),
        ),
        stocks: video.analysis?.stocks || [],
        sectorViews: video.analysis?.sectorViews || [],
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))
        || String(b.name).localeCompare(String(a.name), 'zh-CN')),
  };
}

// 行情与浮盈率：最新价来自 kai_invest_stock_quote（刷新基本面/行情时采集），浮盈率 = (最新价 - 成本价) / 成本价，只展示比率不计算金额。
function enrichHolding(item) {
  return { ...item };
}

/**
 * 数据/分析新鲜度：按交易日计算 dateKey 距今的天数，超过阈值标记 stale。
 * 阈值：A股市场环境 2 个交易日、宏观变量 5 个交易日、板块 2 个交易日。
 */
const STALE_LIMITS = { market: 2, macro: 5, sector: 2 };

function tradingDaysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;
  const from = new Date(`${fromKey}T00:00:00+08:00`);
  const to = new Date(`${toKey}T00:00:00+08:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return 0;
  let count = 0;
  const cursor = new Date(from);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= to) {
    if (isTradingDay(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function freshnessFor(dateKey, limit) {
  const key = String(dateKey || '').slice(0, 10);
  const tradingDays = key ? tradingDaysBetween(key, localDate()) : 0;
  return {
    date: key,
    tradingDays,
    stale: Boolean(key) && tradingDays > limit,
    limit,
  };
}

function buildOverview(store) {
  const portfolio = store.list('portfolio');
  const holdings = portfolio
    .filter((item) => item.list_type === 'holding' && item.quantity > 0 && !item.closed_at)
    .map(enrichHolding);
  // 持仓比例自动计算：当前股票成本价格 × 数量 / 全部活跃持仓成本金额之和（旧手填值会被覆盖，保证展示与日报口径一致）
  const holdingCostTotal = holdings.reduce((sum, item) => sum + (Number(item.cost_price) || 0) * (Number(item.quantity) || 0), 0);
  for (const item of holdings) {
    const cost = (Number(item.cost_price) || 0) * (Number(item.quantity) || 0);
    item.position_pct = holdingCostTotal > 0 ? (cost / holdingCostTotal) * 100 : 0;
  }
  // 持仓列表按仓位从高到低排序（关注列表保持原顺序）
  holdings.sort((a, b) => (Number(b.position_pct) || 0) - (Number(a.position_pct) || 0));
  const watchlist = portfolio.filter((item) => item.list_type === 'watch');
  // 行情装配：最新价 / 当日涨跌幅 / 浮盈率（仅持仓且成本价 > 0）
  const quotesByCode = new Map(store.listQuotes().map((q) => [String(q.stock_code), q]));
  for (const item of [...holdings, ...watchlist]) {
    const quote = quotesByCode.get(String(item.stock_code || '').trim());
    item.latestPrice = quote?.price || null;
    item.quoteChangePct = quote?.change_pct ?? null;
    item.pnlPct = (item.list_type === 'holding' && Number(item.cost_price) > 0 && quote?.price)
      ? ((quote.price - Number(item.cost_price)) / Number(item.cost_price)) * 100
      : null;
  }
  const sectors = store.list('sectors');
  const marketRecords = store.list('market');
  const account = marketRecords.find((item) => item.record_type === 'account') || null;
  const market = marketRecords.find((item) => item.record_type === 'market') || null;
  const macro = marketRecords.filter((item) => item.record_type === 'macro');
  const decisions = store.list('decisions');
  const trades = store.list('trades');
  const videoEvidence = summarizeVideoEvidence();
  // 持仓与关注统一在一个页面展示，基本面数据同时覆盖两类标的
  const stockCodes = [...holdings, ...watchlist]
    .map((item) => String(item.stock_code || '').trim())
    .filter(Boolean);
  const fundamentals = [...new Set(stockCodes)].length
    ? readFundamentalsRows(store, [...new Set(stockCodes)])
    : [];

  const actionableHoldings = holdings.filter((item) => ['减仓', '退出'].includes(item.action_level));
  const incompleteHoldings = holdings.filter((item) => !item.buy_logic || item.thesis_status === '待确认');
  const cautiousVideoSectors = videoEvidence.sectors.filter((item) => item.direction === '偏谨慎').slice(0, 3);
  const positiveVideoSectors = videoEvidence.sectors.filter((item) => item.direction === '偏积极').slice(0, 3);
  const updatedMacro = macro.filter((item) => item.status !== '待更新');
  const hasMarketAssessment = Boolean(market && market.status !== '待更新' && market.risk_level > 0);
  const metrics = account?.metrics || {};
  const completeHoldings = holdings.filter((item) => item.buy_logic && item.thesis_status !== '待确认');
  const hasStockExposure = Number(metrics.stockMarketValue || 0) > 0;

  const riskNotes = unique([
    ...actionableHoldings.map((item) => `${item.stock_name}：${item.action_level}${item.action_reason ? `，${item.action_reason}` : ''}`),
    ...cautiousVideoSectors.map((item) => `视频观点对${item.sector}偏谨慎`),
    incompleteHoldings.length ? `${incompleteHoldings.length} 个持仓缺少完整买入逻辑或逻辑状态待确认` : '',
    !hasMarketAssessment ? '市场行情数据尚未更新，整体风险等级不能完整评估' : '',
  ]).slice(0, 5);

  const opportunityNotes = unique([
    ...sectors.filter((item) => item.rating >= 4).slice(0, 3).map((item) => `${item.name}：${item.status}`),
    ...positiveVideoSectors.map((item) => `视频观点近期关注${item.sector}`),
    watchlist.length ? `关注列表有 ${watchlist.length} 个候选标的等待条件触发` : '',
  ]).slice(0, 5);

  const holdingQuality = holdings.length
    ? completeHoldings.length / holdings.length
    : (hasStockExposure ? 0 : 1);
  const macroQuality = macro.length ? updatedMacro.length / macro.length : 0;
  const completenessChecks = [
    {
      key: 'account',
      label: '账户数据',
      ready: Boolean(metrics.totalAssets),
      score: Boolean(metrics.totalAssets) ? 15 : 0,
      maxScore: 15,
      summary: metrics.totalAssets
        ? `总资产已记录 · ${account?.observed_at || '未填日期'}`
        : '总资产尚未填写',
      observedAt: account?.observed_at || '',
      action: 'account',
    },
    {
      key: 'market',
      label: '市场环境',
      ready: hasMarketAssessment,
      score: hasMarketAssessment ? 25 : 0,
      maxScore: 25,
      summary: hasMarketAssessment
        ? `风险 ${market.risk_level}/5 · ${market.observed_at || '未填日期'}`
        : '缺少可用的风险与机会判断',
      observedAt: market?.observed_at || '',
      action: 'market',
    },
    {
      key: 'portfolio',
      label: '持仓逻辑',
      ready: holdingQuality === 1,
      score: Math.round(holdingQuality * 30),
      maxScore: 30,
      summary: holdings.length
        ? `${completeHoldings.length}/${holdings.length} 个持仓逻辑已确认`
        : (hasStockExposure ? '账户有股票市值，但尚未录入持仓' : '当前没有股票持仓'),
      observedAt: holdings[0]?.updated_at || '',
      action: 'holdings',
    },
    {
      key: 'macro',
      label: '宏观变量',
      ready: macro.length > 0 && updatedMacro.length === macro.length,
      score: Math.round(macroQuality * 15),
      maxScore: 15,
      summary: `${updatedMacro.length}/${macro.length} 个变量已更新`,
      observedAt: macro[0]?.observed_at || '',
      action: 'macro',
    },
    {
      key: 'video',
      label: '视频观点',
      ready: videoEvidence.totalVideos > 0,
      score: videoEvidence.totalVideos > 0 ? 15 : 0,
      maxScore: 15,
      summary: videoEvidence.totalVideos > 0
        ? `${videoEvidence.totalVideos} 条 · 最近 ${videoEvidence.latestDate || '日期未知'}`
        : '研究库尚无可复核观点',
      observedAt: videoEvidence.generatedAt || '',
      action: 'videos',
    },
  ];
  const completeness = completenessChecks.reduce((sum, item) => sum + item.score, 0);

  const reviewTasks = [
    !hasMarketAssessment ? {
      key: 'market-assessment-gap',
      title: '先确认今天的市场环境',
      detail: '缺少风险与机会等级时，系统不能把持仓变化放进市场背景中判断。',
      tone: 'risk',
      sourceLabel: '市场环境',
      sourcePage: 'overview',
      sourceAction: 'market',
    } : null,
    ...actionableHoldings.map((item) => ({
      key: `holding-action-${item.id}`,
      title: `${item.stock_name}需要确认“${item.action_level}”`,
      detail: item.action_reason || item.risk_note || '检查买入逻辑是否变化，并写清本次行动理由。',
      tone: 'risk',
      sourceLabel: `我的持仓 · ${item.stock_code || item.stock_name}`,
      sourcePage: 'holdings',
    })),
    incompleteHoldings.length ? {
      key: 'holding-logic-gap',
      title: `${incompleteHoldings.length} 个持仓的逻辑还没确认`,
      detail: '系统目前只能看到价格和状态，无法判断买入依据是否已经变化。先补充逻辑与触发条件。',
      tone: 'pending',
      sourceLabel: `我的持仓 · ${completeHoldings.length}/${holdings.length} 已确认`,
      sourcePage: 'holdings',
    } : null,
    ...sectors.filter((item) => item.rating >= 4).slice(0, 1).map((item) => ({
      key: `sector-watch-${item.id}`,
      title: `验证${item.name}是否仍值得重点跟踪`,
      detail: `${item.status} · ${item.cycle}。只核对已经记录的验证指标，不把评级当成上涨概率。`,
      tone: 'good',
      sourceLabel: `关注板块 · ${item.rating}/5`,
      sourcePage: 'sectors',
    })),
    ...cautiousVideoSectors.slice(0, 1).map((item) => ({
      key: `video-caution-${item.sector}`,
      title: `复核视频对${item.sector}的谨慎观点`,
      detail: `近期出现 ${item.mentionCount} 次相关观点；先看原文，再决定它是否影响自己的持仓。`,
      tone: 'pending',
      sourceLabel: '视频研究',
      sourcePage: 'videos',
    })),
  ].filter(Boolean).slice(0, 3);

  const marketOut = market ? {
    ...market,
    dataFreshness: freshnessFor(market.observed_at, STALE_LIMITS.market),
    analysisFreshness: freshnessFor(market.analyzed_at, STALE_LIMITS.market),
  } : null;
  const macroOut = macro.map((item) => ({
    ...item,
    dataFreshness: freshnessFor(item.observed_at, STALE_LIMITS.macro),
    analysisFreshness: freshnessFor(item.analyzed_at, STALE_LIMITS.macro),
  }));
  const sectorsOut = sectors.map((item) => ({
    ...item,
    analysisFreshness: freshnessFor(item.analyzed_at, STALE_LIMITS.sector),
  }));

  return {
    generatedAt: new Date().toISOString(),
    tradingDay: {
      today: isTradingDay(),
      next: nextTradingDayKey(),
    },
    account,
    market: marketOut,
    holdings,
    watchlist,
    sectors: sectorsOut,
    macro: macroOut,
    decisions: decisions.slice(0, 12),
    trades: trades.slice(0, 12),
    videoEvidence,
    fundamentals,
    judgment: {
      status: market?.status || '待更新',
      strategy: market?.strategy || '先补全数据，再形成策略。',
      riskLevel: market?.risk_level || 0,
      opportunityLevel: market?.opportunity_level || 0,
      riskNotes,
      opportunityNotes,
      actionableHoldingCount: actionableHoldings.length,
      completeness,
      completenessChecks,
      reviewTasks,
      decisionReview: store.decisionReviewStats(),
      evidenceSources: [
        { key: 'portfolio', label: '我的持仓', count: holdings.length, updatedAt: holdings[0]?.updated_at || null },
        { key: 'market', label: '市场环境', count: hasMarketAssessment ? 1 : 0, updatedAt: market?.updated_at || null },
        { key: 'sector', label: '关注板块', count: sectors.length, updatedAt: sectors[0]?.updated_at || null },
        { key: 'macro', label: '宏观变量', count: updatedMacro.length, updatedAt: macro[0]?.updated_at || null },
        { key: 'video', label: '视频观点', count: videoEvidence.totalVideos, updatedAt: videoEvidence.generatedAt },
      ],
    },
  };
}

function fallbackDailyAnalysis(overview) {
  const holdingActions = overview.holdings
    .filter((item) => ['减仓', '退出'].includes(item.action_level))
    .map((item) => `${item.stock_name}标记为${item.action_level}`);
  const topSector = overview.sectors[0];
  const topVideoSector = overview.videoEvidence.sectors[0];
  const missing = overview.judgment.completenessChecks.filter((item) => !item.ready).map((item) => item.label);

  return {
    title: `${localDate()} 投资日报`,
    event: '每日投资框架检查',
    short_term: overview.market?.status === '待更新'
      ? '实时市场环境尚未补充，暂不对短期方向下确定结论。'
      : `当前市场状态为${overview.market.status}，风险 ${overview.market.risk_level}/5，机会 ${overview.market.opportunity_level}/5。`,
    mid_term: topSector
      ? `${topSector.name}是当前板块池最高评级方向（${topSector.rating}/5），仍需跟踪：${topSector.indicators || '关键验证指标'}。`
      : '板块池尚未形成中期重点方向。',
    action: unique([
      overview.market?.strategy || '',
      ...holdingActions,
      overview.watchlist.length ? `检查 ${overview.watchlist.length} 个观察标的的买入条件是否触发` : '',
    ]).join('；') || '先补齐市场与持仓数据，再制定行动。',
    thesis: topVideoSector
      ? `视频研究库共 ${overview.videoEvidence.totalVideos} 条，当前高频板块为${topVideoSector.sector}；该信号仅作为多源依据之一。`
      : '视频研究库暂无可用于综合判断的板块信号。',
    risk: unique([
      ...overview.judgment.riskNotes,
      missing.length ? `数据缺口：${missing.join('、')}` : '',
    ]).join('；') || '未识别到已记录的显著风险，不代表风险不存在。',
    confidence: overview.judgment.completeness,
  };
}

function extractJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('模型没有返回 JSON');
    return JSON.parse(match[0]);
  }
}

function modelValueToText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(modelValueToText).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const keyLabels = {
      risk_management: '风险管理',
      holdings_review: '持仓复核',
      position_management: '仓位管理',
      watchlist: '观察事项',
      next_step: '下一步',
    };
    return Object.entries(value)
      .map(([key, item]) => {
        const text = modelValueToText(item);
        const label = keyLabels[key] || key.replaceAll('_', ' / ');
        const compactText = text.replace(/[。；，,\s]+$/u, '');
        return compactText ? `${label}：${compactText}` : '';
      })
      .filter(Boolean)
      .join('；');
  }
  return String(value).trim();
}

// 生成日报时发送给 LLM 的输入数据（同时作为分析依据快照存入 kai_invest_decision.input_snapshot，
// 看板可展开查看「当时分析了哪些原始数据」；历史日报展示的是生成时刻的快照，不是当前数据）
function buildAnalysisPayload(overview) {
  return {
    account: overview.account?.metrics || {},
    market: overview.market,
    holdings: overview.holdings.map((item) => ({
      name: item.stock_name,
      code: item.stock_code,
      positionPct: item.position_pct,
      buyLogic: item.buy_logic,
      thesisStatus: item.thesis_status,
      actionLevel: item.action_level,
      risk: item.risk_note,
    })),
    sectors: overview.sectors.slice(0, 8),
    macro: overview.macro,
    recentDecisions: overview.decisions.slice(0, 5),
    videoEvidence: {
      totalVideos: overview.videoEvidence.totalVideos,
      latestDate: overview.videoEvidence.latestDate,
      sectors: overview.videoEvidence.sectors.slice(0, 8),
      recentVideos: overview.videoEvidence.recentVideos.slice(0, 5),
    },
    dataCompleteness: overview.judgment.completeness,
  };
}

async function requestModelAnalysis(payload) {
  const apiKey = process.env.LLM_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  const disabled = String(process.env.LLM_DISABLED || '').toLowerCase() === '1';
  if (!apiKey || disabled) return null;
  const baseUrl = (process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'glm-4-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15_000, Number(process.env.LLM_TIMEOUT_MS || 60_000)));
  const prompt = `你是个人投资决策记录助手，不预测涨停，不承诺收益。请依据输入数据生成今日投资日报。
要求：
1. 区分事实、用户记录和视频外部观点；视频观点只是多种依据之一。
2. 数据缺失时明确说缺失，不得编造实时行情。
3. 行动必须是可复核的条件或风险管理动作。
4. 只返回 JSON，不要 Markdown，结构为：
{"title":"","event":"","short_term":"","mid_term":"","action":"","thesis":"","risk":"","confidence":0}
confidence 是 0-100 的数据充分度，不是投资胜率。

输入：
${JSON.stringify(payload)}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // 不把上游响应体直接抛出（可能含 request id/配额信息，少数网关会 echo API key），
      // 只按状态码分类。详情如需排查，由调用方在后台日志查看。
      const status = response.status;
      await response.text().catch(() => {});
      const hint = status === 401 || status === 403 ? '鉴权失败（检查 API Key）'
        : status === 429 ? '请求过频或额度不足'
        : status >= 500 ? '模型服务暂不可用'
        : '请求参数或网关异常';
      throw new Error(`模型请求失败（HTTP ${status}）：${hint}`);
    }
    const body = await response.json();
    return extractJson(body.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }
}

async function createDailyAnalysis(store, options = {}) {
  const overview = buildOverview(store);
  // 先构造分析输入并保存快照（无论 AI 还是规则回退，依据都来自同一份输入）
  const payload = buildAnalysisPayload(overview);
  let report = null;
  let sourceType = '规则辅助';
  let fallbackReason = '';

  if (!options.forceRules) {
    try {
      report = await requestModelAnalysis(payload);
      if (report) sourceType = `AI · ${process.env.LLM_MODEL || 'glm-4-flash'}`;
    } catch (error) {
      fallbackReason = error.name === 'AbortError' ? '模型请求超时' : error.message;
    }
  }
  if (!report) report = fallbackDailyAnalysis(overview);

  const normalized = {
    decision_type: 'daily_report',
    decision_date: localDate(),
    title: modelValueToText(report.title || `${localDate()} 投资日报`).slice(0, 120),
    event: modelValueToText(report.event || '每日投资框架检查').slice(0, 300),
    short_term: modelValueToText(report.short_term),
    mid_term: modelValueToText(report.mid_term),
    action: modelValueToText(report.action),
    thesis: modelValueToText(report.thesis),
    risk: modelValueToText(report.risk),
    source_type: sourceType,
    source_ids: overview.judgment.evidenceSources.map((item) => ({
      type: item.key,
      count: item.count,
      updatedAt: item.updatedAt,
    })),
    confidence: Number(report.confidence) || overview.judgment.completeness,
    input_snapshot: JSON.stringify(payload),
  };

  return {
    report: store.create('decisions', normalized),
    mode: sourceType,
    fallbackReason,
  };
}

module.exports = {
  buildOverview,
  createDailyAnalysis,
  getVideoResearchLibrary,
  summarizeVideoEvidence,
};
