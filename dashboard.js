const state = {
  overview: null,
  review: null,
  recentReviews: [],
  reviewSaving: false,
  currentPage: 'overview',
  editor: null,
  pendingDelete: null,
  videoLibrary: null,
  videoLibraryLoading: false,
  currentVideoDate: '',
  goldMarket: null,
  goldMarketLoading: false,
  fundamentalsLoading: false,
  analyzeTask: null,
  analyzePollTimer: null,
  collectTask: null,
  collectPollTimer: null,
  marketAnalyzeTask: null,
  marketAnalyzePollTimer: null,
  sectorAnalyzeTask: null,
  sectorAnalyzePollTimer: null,
  holdingFilter: 'all',
  portfolioTab: 'holding',
  operationLogs: null,
  operationLogsLoading: false,
  tasks: null,
  tasksLoading: false,
  tasksPollTimer: null,
  operationLogFilter: 'all',
  operationLogPollTimer: null,
};

// 轮询退避：连续失败时按 1.5x 递增间隔（上限 10s），拿到响应则归零。
// 避免服务挂掉时前端以 1.2-1.5s 固定频率持续打满请求。
const pollFailures = new Map();
function pollInterval(baseMs, key) {
  const fails = pollFailures.get(key) || 0;
  return Math.min(baseMs * Math.pow(1.5, fails), 10000);
}
function pollSucceeded(key) { pollFailures.delete(key); }
function pollFailed(key) { pollFailures.set(key, (pollFailures.get(key) || 0) + 1); }

const pageLabels = {
  overview: '今日决策',
  market: '市场环境',
  holdings: '持仓与关注',
  sectors: '关注板块',
  macro: '宏观变量',
  decisions: 'AI 日报',
  trades: '交易日志',
  videos: '视频研究',
  tasks: '定时任务',
  operations: '运行日志',
};

const formConfigs = {
  holding: {
    resource: 'portfolio',
    title: '持仓',
    subtitle: '仓位按成本价格 × 数量自动计算；数量有变化时必须填写变更原因，系统会自动记录变更。',
    preset: { list_type: 'holding' },
    fields: [
      ['stock_name', '股票名称', 'text', true],
      ['stock_code', '股票代码', 'text'],
      ['security_type', '证券类型', 'select', true, ['stock', 'fund']],
      ['cost_price', '成本价格', 'number', false, '每股/每份价格（元），如 20.5；仓位按成本价格 × 数量自动计算'],
      ['quantity', '持有数量', 'number'],
      ['change_reason', '变更原因（数量有变化时必填）', 'textarea', false, '例如：逻辑未破坏，加仓 100 股 / 达到触发条件，减仓一半'],
      ['buy_logic', '买入逻辑', 'textarea', true, '写清产业、基本面、技术或资金依据'],
      ['thesis_status', '逻辑状态', 'select', false, ['未破坏', '待确认', '开始减弱', '已经破坏']],
      ['trend', '趋势状态', 'select', false, ['上升', '震荡', '调整', '下行', '待评估']],
      ['capital_signal', '资金状态', 'select', false, ['流入', '观察', '流出', '待评估']],
      ['fundamentals', '基本面', 'select', false, ['改善', '正常', '恶化', '待评估']],
      ['action_level', '操作分级', 'select', false, ['持有', '观察', '减仓', '退出']],
      ['action_reason', '操作理由', 'textarea'],
      ['watch_condition', '触发条件', 'textarea', false, '例如：跌破5日线并放量'],
      ['risk_note', '主要风险', 'textarea'],
    ],
  },
  watch: {
    resource: 'portfolio',
    title: '观察标的',
    subtitle: '只有买入条件被验证后，才从观察进入持仓。',
    preset: { list_type: 'watch', action_level: '观察' },
    fields: [
      ['stock_name', '股票名称', 'text', true],
      ['stock_code', '股票代码', 'text'],
      ['buy_logic', '关注原因', 'textarea', true],
      ['watch_condition', '买入条件', 'textarea', true, '每行一个可验证条件'],
      ['risk_note', '排除条件 / 风险', 'textarea'],
      ['trend', '当前趋势', 'select', false, ['上升', '震荡', '调整', '下行', '待评估']],
    ],
  },
  sector: {
    resource: 'sectors',
    title: '板块',
    subtitle: '评级表达关注优先级，不代表上涨概率。',
    fields: [
      ['name', '板块名称', 'text', true],
      ['rating', '评级（1–5）', 'number', true],
      ['cycle', '观察周期', 'select', false, ['短期', '中期', '长期', '周期观察', '待确认']],
      ['status', '当前状态', 'text'],
      ['logic', '核心逻辑', 'textarea', true, '每行一个逻辑'],
      ['risks', '主要风险', 'textarea', false, '每行一个风险'],
      ['indicators', '验证指标', 'textarea', false, '每行一个需要持续跟踪的指标'],
      ['updated_note', '本次变化', 'textarea'],
    ],
  },
  account: {
    resource: 'market',
    title: '账户数据',
    subtitle: '收益率与回撤填写百分数，例如 -18。',
    preset: { record_type: 'account', name: '我的投资账户' },
    fields: [
      ['metric__totalAssets', '总资产', 'number', true],
      ['metric__stockMarketValue', '股票市值', 'number'],
      ['metric__availableCash', '可用现金', 'number'],
      ['metric__accumulatedReturn', '累计收益率（%）', 'number'],
      ['metric__maxDrawdown', '最大回撤（%）', 'number'],
      ['metric__annualTarget', '本年度目标收益（%）', 'number'],
      ['status', '当前风险等级', 'select', false, ['低', '中低', '中', '中高', '高', '待评估']],
      ['rationale', '账户备注', 'textarea'],
      ['observed_at', '数据日期', 'date'],
    ],
  },
  market: {
    resource: 'market',
    title: '市场环境',
    subtitle: '不接实时行情时，请明确填写数据日期和判断依据。',
    preset: { record_type: 'market', name: 'A股市场环境' },
    fields: [
      ['status', '市场状态', 'text', true, '例如：震荡偏强'],
      ['risk_level', '风险等级（0–5）', 'number'],
      ['opportunity_level', '机会等级（0–5）', 'number'],
      ['strategy', '当前策略', 'textarea', true],
      ['rationale', '判断依据', 'textarea', true, '指数趋势、成交量、情绪、涨跌家数、热点持续性'],
      ['metric__indexTrend', '指数趋势', 'text'],
      ['metric__turnover', '两市成交额', 'text'],
      ['metric__northbound', '北向 / 外资', 'text'],
      ['metric__sentiment', '市场情绪', 'text'],
      ['metric__advanceDecline', '涨跌家数', 'text'],
      ['metric__themePersistence', '热点持续性', 'text'],
      ['observed_at', '数据日期', 'date'],
    ],
  },
  macro: {
    resource: 'market',
    title: '宏观变量',
    subtitle: '只记录会改变投资判断的变量。',
    preset: { record_type: 'macro' },
    fields: [
      ['name', '变量名称', 'text', true],
      ['status', '当前状态', 'text', true],
      ['current_value', '当前值 / 当前事实', 'textarea'],
      ['change_note', '最近变化', 'textarea'],
      ['impact_short', '短期影响', 'textarea'],
      ['impact_mid', '中期影响', 'textarea'],
      ['strategy', '需要采取的动作', 'textarea'],
      ['observed_at', '数据日期', 'date'],
    ],
  },
  decision: {
    resource: 'decisions',
    title: '日报复核',
    subtitle: '只对已有日报做复核：认可结论或事后标记正确/部分/错误，避免用结果反推过程。',
    preset: { decision_type: 'manual_view', source_type: '人工记录' },
    fields: [
      ['decision_date', '日期', 'date', true],
      ['title', '判断标题', 'text', true],
      ['event', '事件 / 触发因素', 'textarea'],
      ['short_term', '短期判断', 'textarea'],
      ['mid_term', '中期判断', 'textarea'],
      ['action', '操作计划', 'textarea', true],
      ['thesis', '核心依据', 'textarea', true],
      ['risk', '可能错在哪里', 'textarea'],
      ['confidence', '数据充分度（0–100）', 'number'],
      ['review_outcome', '事后复盘结论', 'select', false, ['pending', 'correct', 'partial', 'wrong']],
      ['review_result', '复盘说明', 'textarea'],
    ],
  },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
const textLines = (value = '') => String(value).split(/\n+/).map(item => item.trim()).filter(Boolean);
const formatMoney = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
// 金额展示固定保留两位小数（如 17109.20），避免小数尾零被吞导致“小数不见了”的错觉
const formatAmount = value => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatSignedMoney = value => `${Number(value) > 0 ? '+' : Number(value) < 0 ? '-' : ''}¥${formatMoney(Math.abs(Number(value) || 0))}`;
const formatDateTime = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未更新';
const formatDuration = ms => {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
};
const formatPercent = value => `${Number(value || 0) > 0 ? '+' : ''}${Number(value || 0).toFixed(1)}%`;
const toneClass = value => ['减仓', '退出', '高', '已经破坏', '偏谨慎', '下跌'].includes(value) ? 'risk' : ['持有', '未破坏', '偏积极', '重点跟踪', '上涨'].includes(value) ? 'good' : 'pending';
const stars = rating => `<span class="star-rating" aria-label="${rating} 星">${'★'.repeat(Math.max(0, Number(rating) || 0))}${'☆'.repeat(Math.max(0, 5 - (Number(rating) || 0)))}</span>`;

async function api(path, options = {}) {
  $('#loading-line').classList.add('active');
  try {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
    return body;
  } finally {
    $('#loading-line').classList.remove('active');
  }
}

function notify(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function renderEmpty(title, copy, buttonText = '', formKey = '') {
  const actionAttribute = formKey === 'daily-report' ? 'data-generate-report' : `data-open-form="${formKey}"`;
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span>${buttonText ? `<button class="button small" ${actionAttribute} type="button">${escapeHtml(buttonText)}</button>` : ''}</div>`;
}

function currentReviewDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function displayReviewDate(value = currentReviewDate()) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long',
  });
}

function reviewStatusLabel(status) {
  return ({ done: '已处理', deferred: '已暂缓', ignored: '已忽略', pending: '未处理' })[status] || '未处理';
}

function reviewProgress(step) {
  const steps = [
    ['确认数据', '知道结论基于什么'],
    ['处理行动', '最多三件事情'],
    ['留下记录', '形成可复盘底稿'],
  ];
  return `<div class="review-progress" aria-label="今日复盘进度">${steps.map((item, index) => {
    const number = index + 1;
    const stateClass = number < step ? 'finished' : number === step ? 'current' : '';
    return `<div class="review-progress-step ${stateClass}" ${number === step ? 'aria-current="step"' : ''}><span class="review-progress-number">${number < step ? '✓' : number}</span><div><strong>${item[0]}</strong><small>${item[1]}</small></div></div>`;
  }).join('')}</div>`;
}

function reviewCheckButton(item) {
  const label = item.ready ? '核对' : '去补充';
  if (item.action === 'account') return `<button class="button ghost small" data-edit-account type="button">${label}</button>`;
  if (item.action === 'market') return `<button class="button ghost small" data-edit-market type="button">${label}</button>`;
  return `<button class="button ghost small" data-page-target="${escapeHtml(item.action)}" type="button">${label}</button>`;
}

function reviewSourceButton(item) {
  if (item.sourceAction === 'market') return '<button class="button ghost small" data-edit-market type="button">查看依据</button>';
  if (!item.sourcePage || item.sourcePage === 'overview') return '';
  return `<button class="button ghost small" data-page-target="${escapeHtml(item.sourcePage)}" type="button">查看依据</button>`;
}

function renderReviewStart(data) {
  const judgment = data.judgment;
  const tasks = judgment.reviewTasks || [];
  const riskCount = tasks.filter(item => item.tone === 'risk').length;
  return `
    <section class="review-intro">
      <div>
        <p class="review-eyebrow">${escapeHtml(displayReviewDate())} · 预计 3 分钟</p>
        <h2>今天只处理真正影响决策的事。</h2>
        <p class="review-intro-copy">不用浏览八个页面。先确认依据是否可靠，再处理最多三个行动项，最后留下一份以后能检查对错的记录。</p>
        <div class="review-intro-actions"><button class="button primary" data-start-review type="button">开始今日复盘</button><small>不会自动下单，也不会把视频观点当成指令。</small></div>
      </div>
      <aside class="review-snapshot" aria-label="今日底稿摘要">
        <div class="review-snapshot-row"><span>当前市场</span><strong>${escapeHtml(judgment.status || '待更新')}</strong></div>
        <div class="review-snapshot-row"><span>数据质量</span><strong>${judgment.completeness}%</strong></div>
        <div class="review-snapshot-row"><span>今日行动</span><strong>${tasks.length} 项</strong></div>
        <div class="review-snapshot-row"><span>其中风险</span><strong>${riskCount} 项</strong></div>
      </aside>
    </section>
    <ol class="review-preview">
      <li><h3>确认依据</h3><p>直接看到每类数据的质量、日期和缺口，不再用“有记录”冒充“可判断”。</p></li>
      <li><h3>只做三个决定</h3><p>对风险与机会选择已处理、暂缓或忽略；每次选择都可以留下理由。</p></li>
      <li><h3>明确结束</h3><p>日报只是总结。完成后系统保存今天的决定，刷新或重启也不会丢失。</p></li>
    </ol>`;
}

function renderReviewDataStep(data) {
  const judgment = data.judgment;
  return `
    <section class="review-step-section">
      <div class="review-step-heading">
        <div><h2>第一步：确认今天依据够不够</h2><p>分数表达数据质量，不表达投资胜率。即使有缺口，也可以明确知情后继续。</p></div>
        <div class="review-quality"><strong>${judgment.completeness}%</strong><span>当前数据质量</span></div>
      </div>
      <div class="review-data-list">${judgment.completenessChecks.map(item => `
        <div class="review-data-row">
          <span class="review-data-mark ${item.ready ? 'ready' : ''}">${item.ready ? '✓' : '!'}</span>
          <div class="review-data-copy"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.summary || '暂无说明')}</span></div>
          <div class="review-data-score"><strong>${Number(item.score || 0)}</strong> / ${Number(item.maxScore || 0)}</div>
          ${reviewCheckButton(item)}
        </div>`).join('')}</div>
      <div class="review-step-actions"><p>${judgment.completeness < 60 ? '数据质量偏低，后续结论会保留不确定性；你仍可按现有信息继续。' : '依据已达到可复盘水平，下一步只看需要处理的事项。'}</p><button class="button primary" data-review-next="2" type="button">确认数据，查看行动项</button></div>
    </section>`;
}

function renderReviewActionStep() {
  const items = state.review?.items || [];
  const pendingCount = items.filter(item => item.status === 'pending').length;
  const rows = items.length ? items.map((item, index) => `
    <article class="review-action-row ${item.status !== 'pending' ? 'resolved' : ''}" data-tone="${escapeHtml(item.tone || 'pending')}">
      <span class="review-action-number">${item.status !== 'pending' ? '✓' : index + 1}</span>
      <div>
        <div class="review-action-head">
          <div><h3>${escapeHtml(item.title)}</h3><p class="review-action-source">${escapeHtml(item.sourceLabel || '综合判断')} · ${reviewStatusLabel(item.status)}</p></div>
          <div class="review-task-controls" role="group" aria-label="处理方式">
            <button class="review-choice ${item.status === 'done' ? 'active' : ''}" data-review-task="${escapeHtml(item.key)}" data-task-status="done" type="button">已处理</button>
            <button class="review-choice ${item.status === 'deferred' ? 'active' : ''}" data-review-task="${escapeHtml(item.key)}" data-task-status="deferred" type="button">暂缓</button>
            <button class="review-choice ${item.status === 'ignored' ? 'active' : ''}" data-review-task="${escapeHtml(item.key)}" data-task-status="ignored" type="button">忽略</button>
          </div>
        </div>
        <p class="review-action-detail">${escapeHtml(item.detail)}</p>
        ${reviewSourceButton(item)}
        <textarea class="review-task-note" data-review-note="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.title)}的处理理由" placeholder="补一句理由，尤其是为什么暂缓或忽略">${escapeHtml(item.note || '')}</textarea>
      </div>
    </article>`).join('') : '<div class="review-no-actions"><strong>今天没有需要立即处理的事项。</strong><p class="muted">这不代表没有市场风险，只表示现有记录没有触发行动条件。</p></div>';
  return `
    <section class="review-step-section">
      <div class="review-step-heading"><div><h2>第二步：把行动收敛到三件以内</h2><p>“暂缓”和“忽略”也是决定，只要理由清楚。这里记录的是你的选择，不是 AI 指令。</p></div></div>
      <div class="review-action-list">${rows}</div>
      <div class="review-step-actions"><p>${pendingCount ? `还有 ${pendingCount} 项没有选择处理方式。` : '行动项已经全部处理，可以形成今天的结论。'}</p><button class="button primary" data-review-next="3" type="button" ${pendingCount ? 'disabled' : ''}>${pendingCount ? `先处理剩余 ${pendingCount} 项` : '查看今日结论'}</button></div>
    </section>`;
}

function renderReviewReport(report) {
  if (!report) return '<div><h3>还没有今天的投资日报</h3><p class="muted">日报用于总结已经确认的依据和行动，不替你做最终决定。</p></div>';
  return `
    <div class="review-report-head"><div><h3>${escapeHtml(report.title)}</h3><p>${escapeHtml(report.source_type)} · 数据质量 ${Number(report.confidence || 0)}%</p></div><span class="status-pill good">已生成</span></div>
    <div class="review-report-body">
      <div><span>短期判断</span><strong>${escapeHtml(report.short_term || '未记录')}</strong></div>
      <div><span>中期判断</span><strong>${escapeHtml(report.mid_term || '未记录')}</strong></div>
      <div><span>行动</span><strong>${escapeHtml(report.action || '未记录')}</strong></div>
      <div><span>可能错在哪里</span><strong>${escapeHtml(report.risk || '未记录')}</strong></div>
    </div>`;
}

function renderReviewConclusionStep(data) {
  const report = data.decisions.find(item => item.decision_type === 'daily_report' && item.decision_date === currentReviewDate());
  return `
    <section class="review-step-section">
      <div class="review-step-heading"><div><h2>第三步：留下今天能被检验的记录</h2><p>日报可重新生成，但不是完成复盘的前提。最重要的是保存你今天选择了什么，以及为什么。</p></div></div>
      <div class="review-report-sheet">${renderReviewReport(report)}<div><button class="button ${report ? 'ghost' : ''}" data-generate-report data-review-report type="button">${report ? '重新生成日报' : '生成今日日报'}</button></div></div>
      <div class="review-summary-field"><label for="review-summary-note">今天最需要记住的一句话</label><small>可选。例如：不因盘中波动改变已经确认的退出条件。</small><textarea id="review-summary-note" placeholder="写下今天的纪律、疑问或需要继续验证的事情">${escapeHtml(state.review?.summary_note || '')}</textarea></div>
      <div class="review-step-actions"><p>完成后会写入本地数据库。之后仍可重新打开，不会锁死记录。</p><button class="button primary" data-complete-review type="button">完成今日复盘</button></div>
    </section>`;
}

function renderReviewCompleted(data) {
  const items = state.review?.items || [];
  const recent = state.recentReviews || [];
  const recentItems = recent.flatMap(item => item.items || []);
  const completedDays = recent.filter(item => item.status === 'completed').length;
  const processedCount = recentItems.filter(item => item.status === 'done').length;
  const deferredCount = recentItems.filter(item => item.status === 'deferred').length;
  const latestReport = data.decisions.find(item => item.decision_type === 'daily_report' && item.decision_date === currentReviewDate());
  return `
    <section class="review-complete">
      <div>
        <span class="review-complete-mark" aria-hidden="true">✓</span>
        <h2>今天的复盘已经完成。</h2>
        <p class="review-complete-copy">系统已经保存你处理过的事项和理由。接下来不需要继续维护页面，只有持仓或判断发生变化时再回来。</p>
        <div class="review-complete-actions"><button class="button" data-reopen-review type="button">重新打开今日复盘</button><button class="button ghost" data-page-target="decisions" type="button">查看日报</button></div>
      </div>
      <aside class="review-weekly">
        <h3>最近 7 次记录</h3>
        <div class="review-weekly-row"><span>完成复盘</span><strong>${completedDays} 天</strong></div>
        <div class="review-weekly-row"><span>已处理事项</span><strong>${processedCount} 项</strong></div>
        <div class="review-weekly-row"><span>明确暂缓</span><strong>${deferredCount} 项</strong></div>
        <div class="review-weekly-row"><span>今日日报</span><strong>${latestReport ? '已生成' : '未生成'}</strong></div>
      </aside>
    </section>
    <section class="review-complete-list">
      <div class="section-head"><h2>今天留下了什么</h2><small>${escapeHtml(formatDateTime(state.review?.completed_at))}</small></div>
      ${items.map(item => `<div class="review-complete-item"><span>${reviewStatusLabel(item.status)}</span><div><strong>${escapeHtml(item.title)}</strong>${item.note ? `<p class="muted">${escapeHtml(item.note)}</p>` : ''}</div></div>`).join('') || '<div class="review-complete-item"><span>无行动项</span><div><strong>今天没有触发需要处理的事项</strong></div></div>'}
      ${state.review?.summary_note ? `<div class="review-complete-item"><span>今日一句话</span><div><strong>${escapeHtml(state.review.summary_note)}</strong></div></div>` : ''}
    </section>`;
}

// A 股交易日：YYYY-MM-DD -> 「8月3日（周一）」
function formatTradingDate(value) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value || '—';
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${week}）`;
}

// 非交易日：不引导复盘，只展示休市说明与最近复盘概览
function renderNonTradingDay(data) {
  const next = formatTradingDate(data.tradingDay.next);
  const recent = state.recentReviews || [];
  const completedDays = recent.filter(item => item.status === 'completed').length;
  const lastCompleted = recent.find(item => item.status === 'completed');
  const lastLine = lastCompleted
    ? `最近一次复盘：${formatTradingDate(lastCompleted.review_date)} 已完成`
    : '还没有完成过复盘';
  return `
    <section class="review-intro">
      <div>
        <p class="review-eyebrow">${escapeHtml(displayReviewDate())} · 今日 A 股休市</p>
        <h2>今天不是交易日，无需复盘。</h2>
        <p class="review-intro-copy">下一交易日为 ${escapeHtml(next)}。复盘只在交易日进行：确认依据 → 处理行动项 → 留下可检验的记录。今天不会有新数据，也不会生成日报。</p>
        <div class="review-intro-actions"><button class="button" data-page-target="decisions" type="button">查看历史日报</button><small>${escapeHtml(lastLine)}</small></div>
      </div>
      <aside class="review-snapshot" aria-label="最近复盘概览">
        <div class="review-snapshot-row"><span>下一交易日</span><strong>${escapeHtml(next)}</strong></div>
        <div class="review-snapshot-row"><span>近 7 次完成</span><strong>${completedDays} 次</strong></div>
        <div class="review-snapshot-row"><span>最近一次</span><strong>${lastCompleted ? escapeHtml(formatTradingDate(lastCompleted.review_date)) : '—'}</strong></div>
      </aside>
    </section>
    <ol class="review-preview">
      <li><h3>不用记今天</h3><p>非交易日没有收盘数据，也没有要处理的行动项，复盘自动跳过。</p></li>
      <li><h3>数据仍可看</h3><p>持仓、关注、行情和日报页面照常可浏览，只是不需要做每日收敛。</p></li>
      <li><h3>下个交易日见</h3><p>${escapeHtml(next)} 收盘后回到这里，继续今天的节奏。</p></li>
    </ol>`;
}

function renderOverview() {
  const data = state.overview;
  if (!data) return;
  if (!data.tradingDay?.today) {
    $('#overview-content').innerHTML = renderNonTradingDay(data);
    return;
  }
  if (!state.review) {
    $('#overview-content').innerHTML = renderReviewStart(data);
    return;
  }
  if (state.review.status === 'completed') {
    $('#overview-content').innerHTML = renderReviewCompleted(data);
    return;
  }
  const step = Number(state.review.current_step || 1);
  const content = step === 1
    ? renderReviewDataStep(data)
    : step === 2
      ? renderReviewActionStep()
      : renderReviewConclusionStep(data);
  $('#overview-content').innerHTML = `
    <header class="review-masthead"><div><p class="review-eyebrow">${escapeHtml(displayReviewDate())} · 今日复盘</p><h2>${escapeHtml(data.judgment.status || '待形成市场判断')}</h2></div><p class="review-masthead-copy">${escapeHtml(data.judgment.strategy || '先补全数据，再形成策略。')}</p></header>
    ${reviewProgress(step)}
    ${content}`;
}

function renderHoldingsGuide(holdings) {
  const pending = holdings.filter(h => h.thesis_status === '待确认' || !h.buy_logic);
  if (!holdings.length) return '';
  if (!pending.length) {
    return `<div class="holdings-guide"><div><strong>持仓逻辑已完整</strong><p>保持定期复核，避免逻辑变化后才被动反应。</p></div></div>`;
  }
  const active = state.holdingFilter === 'pending';
  return `<div class="holdings-guide attention">
    <div><strong>${pending.length} 个持仓的逻辑待确认</strong><p>补全买入依据与失效条件，系统才能判断逻辑是否仍然成立。</p></div>
    <button class="button small" data-holding-filter="${active ? 'all' : 'pending'}" type="button">${active ? '显示全部持仓' : `只看待确认（${pending.length}）`}</button>
  </div>`;
}

function renderHoldingFundamentals(data, holding) {
  if (!String(holding.stock_code || '').trim()) {
    return `<section class="holding-fundamentals is-missing">
      <div class="holding-section-head"><span>最新基本面</span><strong>待填写股票代码</strong></div>
      <p>补充代码后即可拉取财务摘要。</p>
    </section>`;
  }
  if (!data) {
    return `<section class="holding-fundamentals is-missing">
      <div class="holding-section-head"><span>最新基本面</span><strong>暂无公开财务数据</strong></div>
      <p>可刷新重试；若数据源仍未收录，不影响持仓记录与复盘。</p>
    </section>`;
  }
  const m = data.metrics || {};
  const metrics = [
    ['每股收益', renderFundamentalMetric(m, 'epsjb')],
    ['每股净资产', renderFundamentalMetric(m, 'bps')],
    ['营收同比', renderFundamentalMetric(m, 'totaloperaterevetz', fmtPct), m.totaloperaterevetz?.value],
    ['归母净利同比', renderFundamentalMetric(m, 'parentnetprofittz', fmtPct), m.parentnetprofittz?.value],
    ['扣非同比', renderFundamentalMetric(m, 'kcfjcxsyjlrtz', fmtPct), m.kcfjcxsyjlrtz?.value],
  ];
  return `<section class="holding-fundamentals">
    <div class="holding-section-head"><span>最新基本面</span><strong>${escapeHtml(data.report_type || '财报')} · ${escapeHtml(data.report_date || '日期待确认')}</strong><small>阿里云极速数据</small></div>
    <dl class="fundamental-metrics">${metrics.map(([label, value, raw]) => {
      const tone = raw == null ? '' : (Number(raw) < 0 ? 'negative' : 'positive');
      return `<div><dt>${escapeHtml(label)}</dt><dd class="${tone}">${value}</dd></div>`;
    }).join('')}</dl>
  </section>`;
}

// 关注中卡片的辅助展示：观察天数（自创建起）与短日期
function watchDays(value) {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return '—';
  const days = Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000));
  return days === 0 ? '今天' : `${days} 天`;
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// 持仓与关注统一卡片：样式一致，均展示基本面；用「持仓中 / 关注中」标记区分
function renderPortfolioRow(item, fundamental) {
  const isHolding = item.list_type === 'holding';
  const logicGap = isHolding && (item.thesis_status === '待确认' || !item.buy_logic);
  const quoteSub = item.latestPrice == null ? ''
    : isHolding
      ? (item.pnlPct == null ? '' : `<small class="quote-sub ${item.pnlPct >= 0 ? 'up' : 'down'}">浮盈 ${item.pnlPct >= 0 ? '+' : ''}${item.pnlPct.toFixed(1)}%</small>`)
      : (item.quoteChangePct == null ? '' : `<small class="quote-sub ${item.quoteChangePct >= 0 ? 'up' : 'down'}">${item.quoteChangePct >= 0 ? '+' : ''}${item.quoteChangePct.toFixed(1)}%</small>`);
  const positionCells = isHolding
    ? `<div><dt>仓位</dt><dd>${Number(item.position_pct || 0).toFixed(1)}%</dd></div>
        <div><dt>数量</dt><dd>${formatMoney(item.quantity)}</dd></div>
        <div><dt>成本价格</dt><dd>¥${formatAmount(item.cost_price)}</dd></div>
        <div><dt>最新价</dt><dd>${item.latestPrice == null ? '—' : `¥${formatAmount(item.latestPrice)}`}</dd>${quoteSub}</div>
        <div><dt>当前趋势</dt><dd>${escapeHtml(item.trend)}</dd></div>`
    : `<div><dt>最新价</dt><dd>${item.latestPrice == null ? '—' : `¥${formatAmount(item.latestPrice)}`}</dd>${quoteSub}</div>
        <div><dt>当前趋势</dt><dd>${escapeHtml(item.trend)}</dd></div>
        <div><dt>逻辑状态</dt><dd>${escapeHtml(item.thesis_status)}</dd></div>
        <div><dt>观察天数</dt><dd>${watchDays(item.created_at)}</dd></div>
        <div><dt>更新时间</dt><dd>${shortDate(item.updated_at)}</dd></div>`;
  const sourceNote = !isHolding && item.source_note
    ? `<div><dt>来源</dt><dd>${escapeHtml(item.source_note)}</dd></div>` : '';
  const riskRow = item.risk_note
    ? `<div><dt>${isHolding ? '主要风险' : '排除风险'}</dt><dd>${escapeHtml(item.risk_note)}</dd></div>` : '';
  const actions = isHolding
    ? `<button class="button ghost small" data-edit-resource="portfolio" data-record-id="${item.id}" type="button">${logicGap ? '补全逻辑' : '编辑'}</button><button class="button ghost small" data-delete-resource="portfolio" data-record-id="${item.id}" type="button">删除</button>`
    : `<button class="button small" data-to-holding="${item.id}" type="button">转入持仓</button><button class="button ghost small" data-edit-resource="portfolio" data-record-id="${item.id}" type="button">编辑</button><button class="button ghost small" data-delete-resource="portfolio" data-record-id="${item.id}" type="button">删除</button>`;
  return `<article class="holding-sheet${logicGap ? ' attention' : ''}">
    <header class="holding-sheet-head">
      <div class="holding-title"><div><h2>${escapeHtml(item.stock_name)}</h2><span>${escapeHtml(item.stock_code || '未填代码')}</span></div><div class="holding-status"><span class="status-pill ${isHolding ? 'good' : 'pending'}">${isHolding ? '持仓中' : '关注中'}</span>${isHolding ? `<span class="status-pill ${toneClass(item.action_level)}">${escapeHtml(item.action_level)}</span>` : ''}${logicGap ? '<span class="status-pill pending">逻辑待确认</span>' : ''}</div></div>
      <dl class="holding-position">
        ${positionCells}
      </dl>
      <div class="record-actions">${actions}</div>
    </header>
    <div class="holding-sheet-body">
      <section class="holding-thesis">
        <div class="holding-section-head"><span>${isHolding ? '持仓判断' : '关注判断'}</span><strong>${escapeHtml(item.thesis_status || '待确认')}</strong></div>
        <dl><div><dt>${isHolding ? '买入逻辑' : '关注原因'}</dt><dd>${escapeHtml(item.buy_logic || (isHolding ? '尚未记录，请补全这只持仓的买入依据。' : '尚未记录关注原因。'))}</dd></div><div><dt>当前判断</dt><dd>${escapeHtml(item.action_reason || `${item.trend} · 逻辑${item.thesis_status}`)}</dd></div><div><dt>行动条件</dt><dd>${escapeHtml(item.watch_condition || '尚未设置触发条件。')}</dd></div>${sourceNote}${riskRow}</dl>
      </section>
      ${renderHoldingFundamentals(fundamental, item)}
    </div>
  </article>`;
}

function renderPortfolioTabs(holdings, watchlist) {
  return `<div class="portfolio-tabs" role="tablist" aria-label="持仓与关注">
    <button class="portfolio-tab${state.portfolioTab === 'holding' ? ' active' : ''}" data-portfolio-tab="holding" type="button" role="tab" aria-selected="${state.portfolioTab === 'holding'}">持仓中<span>${holdings.length}</span></button>
    <button class="portfolio-tab${state.portfolioTab === 'watch' ? ' active' : ''}" data-portfolio-tab="watch" type="button" role="tab" aria-selected="${state.portfolioTab === 'watch'}">关注中<span>${watchlist.length}</span></button>
  </div>`;
}

function renderFundamentals() {
  if (state.fundamentalsLoading) {
    $('#fundamentals-content').innerHTML = `<div class="fundamentals-sync"><span aria-hidden="true"></span><div><strong>正在更新基本面</strong><p>按持仓与关注逐只读取最新财务报告，完成后会更新到对应卡片。</p></div></div>`;
    return;
  }
  $('#fundamentals-content').innerHTML = '';
}

function fmtNum(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function fmtPct(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(digits)}%`;
}

function renderFundamentalMetric(metrics, key, formatter = fmtNum) {
  const item = metrics[key];
  if (!item || item.value == null) return '<span class="muted">—</span>';
  return formatter(item.value);
}

function freshnessPill(fresh, staleLabel, freshLabel) {
  if (!fresh || !fresh.date) return '';
  if (fresh.stale) {
    const label = String(staleLabel).replace('{d}', String(fresh.tradingDays));
    return `<span class="status-pill risk" title="有效期 ${fresh.limit} 个交易日">${escapeHtml(label)}</span>`;
  }
  return freshLabel ? `<span class="status-pill good">${escapeHtml(freshLabel)}</span>` : '';
}

function renderSectorRow(item) {
  return `<article class="record-row">
    <div class="record-identity"><h3>${escapeHtml(item.name)}</h3><p>${stars(item.rating)}</p><span class="status-pill ${toneClass(item.status)}">${escapeHtml(item.status)}</span></div>
    <div class="record-copy"><p><strong>逻辑：</strong>${escapeHtml(textLines(item.logic).join('；') || '未记录')}</p><p><strong>风险：</strong>${escapeHtml(textLines(item.risks).join('；') || '未记录')}</p><p><strong>验证指标：</strong>${escapeHtml(textLines(item.indicators).join('；') || '未记录')}</p></div>
    <div class="record-numbers"><div><span>周期</span><strong>${escapeHtml(item.cycle)}</strong></div><div><span>最近变化</span><strong>${escapeHtml(item.updated_note || '无')}</strong></div></div>
    <div class="record-actions"><button class="button ghost small" data-edit-resource="sectors" data-record-id="${item.id}" type="button">编辑</button><button class="button ghost small" data-delete-resource="sectors" data-record-id="${item.id}" type="button">删除</button></div>
    ${renderSectorAnalysis(item)}
  </article>`;
}

// ─── 板块 AI 参考分析：基于最近行情生成，不改动人工评级/逻辑 ───
function renderSectorAnalysis(item) {
  if (!item.analysis_source || !item.analysis_note) return '';
  let note;
  try {
    note = JSON.parse(item.analysis_note);
  } catch {
    return '';
  }
  const signals = Array.isArray(note.signals)
    ? `<ul class="sector-signals">${note.signals.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    : escapeHtml(String(note.signals || ''));
  const adoptable = note.suggestedRating != null && note.suggestedStatus;
  const adoptButton = adoptable
    ? `<button class="button small" data-adopt-sector-analysis="${item.id}" type="button">采纳建议</button>`
    : '';
  const rawIndicators = (() => {
    try {
      const parsed = JSON.parse(item.indicators || '{}');
      return JSON.stringify(parsed, null, 2);
    } catch {
      return item.indicators || '{}';
    }
  })();
  return `<div class="sector-analysis-wrap">
    <details class="decision-input">
      <summary>AI 参考分析 <small>${escapeHtml(item.analysis_source)} · ${escapeHtml(formatDateTime(item.analyzed_at))}</small>${freshnessPill(item.analysisFreshness, '已过期（{d} 个交易日前）', '')}</summary>
      <div class="sector-analysis-caption"><p>以下为 AI 基于最近行情的参考分析，未自动改动你的判断；点击「采纳建议」后才会写入评级与状态。</p>${adoptButton}</div>
      <dl class="decision-input-rows">
        <div class="decision-input-row"><dt>现状</dt><dd>${escapeHtml(note.summary || '')}</dd></div>
        <div class="decision-input-row"><dt>关键信号</dt><dd>${signals}</dd></div>
        ${note.attention ? `<div class="decision-input-row"><dt>关注点</dt><dd>${escapeHtml(note.attention)}</dd></div>` : ''}
        <div class="decision-input-row"><dt>参考评级</dt><dd>${Number(note.suggestedRating || 0).toFixed(1)}/5（当前你记录的评级：${escapeHtml(String(item.rating))}）</dd></div>
        <div class="decision-input-row"><dt>状态建议</dt><dd>${escapeHtml(note.suggestedStatus || '')}（当前：${escapeHtml(item.status)}）</dd></div>
      </dl>
      <details class="decision-input-raw"><summary>查看最近行情原始数据（采集结果）</summary><pre>${escapeHtml(rawIndicators)}</pre></details>
    </details>
  </div>`;
}

function renderSectorAnalyzePanel() {
  return renderAnalyzePanel(state.sectorAnalyzeTask);
}

function updateSectorButtons() {
  const analyzeButton = $('[data-analyze-sector]');
  if (analyzeButton) {
    const busy = state.sectorAnalyzeTask && state.sectorAnalyzeTask.running;
    const collecting = state.collectTask && state.collectTask.running;
    analyzeButton.disabled = busy || collecting;
    analyzeButton.textContent = busy ? '分析中…' : 'AI 分析板块';
  }
  const collectButton = $('.page[data-page="sectors"] [data-collect="sector"]');
  if (collectButton) collectButton.disabled = Boolean(state.sectorAnalyzeTask && state.sectorAnalyzeTask.running);
}

function renderSectorPages() {
  const data = state.overview;
  if (!data) return '';
  updateSectorButtons();
  return `${renderSectorAnalyzePanel()}${data.sectors.length
    ? `<div class="record-list">${data.sectors.map(renderSectorRow).join('')}</div>`
    : renderEmpty('还没有关注板块', '从一个真正愿意持续跟踪的方向开始。', '添加板块', 'sector')}`;
}

function renderMacroRow(item) {
  return `<article class="market-sheet">
    <div class="record-identity"><h3>${escapeHtml(item.name)}</h3><span class="status-pill ${toneClass(item.status)}">${escapeHtml(item.status)}</span><p class="record-code">${escapeHtml(item.observed_at || '未填数据日期')}${freshnessPill(item.dataFreshness, '过期 {d} 交易日', '较新')}</p></div>
    <div class="record-copy"><p><strong>当前：</strong>${escapeHtml(item.current_value || '待录入')}</p><p><strong>变化：</strong>${escapeHtml(item.change_note || '待录入')}</p><div class="judgment-columns"><p><strong>短期：</strong>${escapeHtml(item.impact_short || '待判断')}</p><p><strong>中期：</strong>${escapeHtml(item.impact_mid || '待判断')}</p></div><p><strong>动作：</strong>${escapeHtml(item.strategy || '未设置')}</p><div class="record-actions" style="margin-top:12px"><button class="button ghost small" data-edit-resource="market" data-record-id="${item.id}" type="button">编辑</button><button class="button ghost small" data-delete-resource="market" data-record-id="${item.id}" type="button">删除</button></div></div>
  </article>`;
}

function renderGoldMarket() {
  const market = state.goldMarket;
  if (!market) {
    return `<section class="gold-market-panel"><div class="video-loading"><strong>${state.goldMarketLoading ? '正在读取上海黄金交易所行情…' : '黄金行情尚未载入'}</strong><span>${state.goldMarketLoading ? '数据将写入黄金变量，并参与后续 AI 日报。' : '点击“刷新黄金行情”获取最新报价。'}</span></div></section>`;
  }
  const quoteHtml = market.quotes.slice(0, 4).map(item => {
    const change = Number(item.changePercent || 0);
    return `<article class="gold-quote">
      <span class="gold-quote-name">${escapeHtml(item.name)} · ${escapeHtml(item.symbol)}</span>
      <strong class="gold-quote-price">${formatMoney(item.price)} <small>${escapeHtml(item.unit)}</small></strong>
      <div class="gold-quote-meta"><span class="${change < 0 ? 'negative' : 'positive'}">${formatPercent(change)}</span><span class="muted">高 ${item.high ?? '—'} / 低 ${item.low ?? '—'}</span></div>
    </article>`;
  }).join('');
  return `<section class="gold-market-panel">
    <div class="gold-market-head"><div><h2>上海黄金交易所</h2><p>市场时间 ${escapeHtml(market.marketUpdatedAt || '未知')} · ${market.cached ? '5 分钟缓存' : '刚刚同步'}</p></div><button class="button small" data-refresh-gold type="button">立即更新</button></div>
    <div class="gold-quote-grid">${quoteHtml}</div>
    <p class="gold-market-source">来源：<a href="${escapeHtml(market.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(market.provider)}</a>。行情仅作为研究依据，不构成投资建议。</p>
  </section>`;
}

function renderMacroPage() {
  if (!state.overview) return;
  // §2.3：宏观数据过期时引导重新采集（不止挂药丸）
  const staleItems = state.overview.macro.filter((item) => item.dataFreshness?.stale);
  const staleHint = staleItems.length
    ? `<div class="stale-banner" role="status"><strong>${staleItems.length} 个宏观变量数据已过期</strong>（${staleItems.map((i) => escapeHtml(i.name)).join('、')}）。过期数据可能误导判断，建议点击上方「采集宏观行情」更新。</div>`
    : '';
  const rows = state.overview.macro.length
    ? state.overview.macro.map(renderMacroRow).join('')
    : renderEmpty('还没有宏观变量', '只添加会影响持仓、板块或仓位的变量。', '添加变量', 'macro');
  $('#macro-content').innerHTML = `${renderGoldMarket()}${staleHint}${rows}`;
}

// ─── 市场环境页：原始数据 + AI 分析结果，分开展示，可重新分析 ───

// 注意：value 与 meta 故意允许包含 HTML（如 <span class="muted">待采集</span> 占位），
// 调用方必须保证传入内容可信——目前所有调用方传入的是数字或本地代码生成的固定文案，
// 不直接拼接来自 HTTP 接口的原始字符串。若未来要展示外部采集的原始文本，必须先 escapeHtml。
function marketMetricCard(label, value, meta = '', tone = '') {
  return `<article class="market-metric">
    <span class="market-metric-label">${escapeHtml(label)}</span>
    <strong class="market-metric-value ${tone}">${value}</strong>
    ${meta ? `<span class="market-metric-meta">${meta}</span>` : ''}
  </article>`;
}

function renderMarketIndexCard(title, index, codeLabel) {
  if (!index) return marketMetricCard(title, '<span class="muted">待采集</span>', codeLabel);
  const change = Number(index.changePct || 0);
  const tone = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
  return marketMetricCard(
    `${title}<small>${escapeHtml(codeLabel)}</small>`,
    `${formatMoney(index.price)}`,
    `${change > 0 ? '+' : ''}${formatPercent(change)} · 昨收 ${formatMoney(index.prevClose)}`,
    tone,
  );
}

function renderMarketRawData(market) {
  if (!market) {
    return `<section class="market-panel"><div class="video-loading"><strong>市场环境记录尚未建立</strong><span>先点击「采集市场」拉取指数、成交额与市场情绪数据。</span></div></section>`;
  }
  const m = market.metrics || {};
  const indexTrend = m.indexTrend || {};
  const turnover = m.turnover || {};
  const mainFunds = m.mainFunds || {};
  const ad = m.advanceDecline || null;
  const notUpdated = market.status === '待更新' || !market.observed_at;
  const rawJson = JSON.stringify(m, null, 2) || '{}';
  return `<section class="market-panel market-raw">
    <div class="market-panel-head">
      <div><h2>原始行情数据</h2><p class="muted">采集结果原样展示，AI 分析只读不改；数据日期 ${escapeHtml(market.observed_at || '未填写')}</p></div>
      ${freshnessPill(market.dataFreshness, '数据已过期（{d} 个交易日）', '数据较新')}
      <span class="status-pill ${notUpdated ? 'pending' : 'good'}">${escapeHtml(notUpdated ? '待更新' : market.status)}</span>
    </div>
    <div class="market-metric-grid">
      ${renderMarketIndexCard('上证指数', indexTrend.sh, 'sh000001')}
      ${renderMarketIndexCard('深证成指', indexTrend.sz, 'sz399001')}
      ${marketMetricCard('两市成交额', turnover.text || '<span class="muted">待采集</span>', turnover.yuan ? `单位：元 · ${Number(turnover.yuan).toLocaleString('zh-CN')}` : '')}
      ${marketMetricCard('主力资金净流入', mainFunds.mainNet != null ? `${mainFunds.mainNet} 亿` : '<span class="muted">暂无公开数据</span>', mainFunds.mainPct != null ? `占比 ${mainFunds.mainPct}%` : '', (mainFunds.mainNet || 0) > 0 ? 'positive' : (mainFunds.mainNet || 0) < 0 ? 'negative' : '')}
      ${marketMetricCard('涨跌家数', ad ? `涨 ${ad.up} / 平 ${ad.flat} / 跌 ${ad.down}` : '<span class="muted">暂无公开数据</span>', ad && ad.up > 0 && ad.down > 0 ? `涨跌比 ${(ad.up / ad.down).toFixed(2)}` : '')}
      ${marketMetricCard('市场情绪', m.sentiment || '<span class="muted">待采集</span>')}
      ${marketMetricCard('热点持续性', m.themePersistence || '<span class="muted">待采集</span>')}
    </div>
    <dl class="market-detail-list">
      <div><dt>汇总</dt><dd>${escapeHtml(market.current_value || '待录入')}</dd></div>
      <div><dt>变化说明</dt><dd>${escapeHtml(market.change_note || '待录入')}</dd></div>
      ${m.northbound ? `<div><dt>北向资金</dt><dd>${escapeHtml(m.northbound)}</dd></div>` : ''}
      <div><dt>数据来源</dt><dd>${escapeHtml(market.rationale || '未记录来源')}</dd></div>
    </dl>
    <details class="market-raw-json"><summary>查看完整原始数据（JSON）</summary><pre>${escapeHtml(rawJson)}</pre></details>
  </section>`;
}

function renderMarketAnalysis(market) {
  const analyzed = Boolean(market && market.analysis_source && market.analyzed_at);
  if (!market) return '';
  if (!analyzed) {
    return `<section class="market-panel market-analysis is-empty">
      <div class="market-panel-head"><div><h2>AI 分析结果</h2><p class="muted">尚未生成。先采集行情数据，再点击右上角「AI 分析」。</p></div><span class="status-pill pending">未分析</span></div>
      <div class="video-loading"><strong>还没有基于原始数据的分析结论</strong><span>分析只依据上方「原始行情数据」生成，缺失指标会被如实标注，不会被补全或编造。</span></div>
    </section>`;
  }
  const hotTone = (level) => (level >= 4 ? 'risk' : level <= 2 ? 'good' : '');
  const badge = (label, value, tone, suffix = '/5') => `<article class="market-analysis-badge ${tone}">
    <span>${escapeHtml(label)}</span><strong>${Number(value || 0).toFixed(1)}<small>${escapeHtml(suffix)}</small></strong>
  </article>`;
  return `<section class="market-panel market-analysis">
    <div class="market-panel-head">
      <div><h2>AI 分析结果</h2><p class="muted">${escapeHtml(market.analysis_source || '')} · ${escapeHtml(formatDateTime(market.analyzed_at))} · 基于上方原始数据生成</p></div>
      ${freshnessPill(market.analysisFreshness, '分析已过期（{d} 个交易日前）', '分析有效')}
      <div class="heading-actions"><button class="button ghost small" data-edit-market type="button">人工调整</button><button class="button small" data-analyze-market type="button">重新分析</button></div>
    </div>
    <div class="market-analysis-badges">
      ${badge('风险等级', market.risk_level, hotTone(market.risk_level))}
      ${badge('机会等级', market.opportunity_level, hotTone(market.opportunity_level))}
      ${badge('综合评分', market.score, hotTone(market.score))}
    </div>
    <dl class="market-detail-list">
      <div><dt>市场策略</dt><dd>${escapeHtml(market.strategy || '未生成')}</dd></div>
      <div><dt>分析依据</dt><dd>${escapeHtml(market.rationale || '未生成')}</dd></div>
    </dl>
  </section>`;
}

function renderAnalyzePanel(task) {
  if (!task || (!task.running && !task.finishedAt)) return '';
  const tone = task.error ? 'failed' : (task.running ? 'running' : 'done');
  const pill = task.error
    ? '<span class="analyze-status-pill">分析失败</span>'
    : task.running
      ? '<span class="analyze-status-pill"><span class="analyze-spinner"></span>正在分析</span>'
      : '<span class="analyze-status-pill">已完成</span>';
  const heading = task.error ? '分析出错' : task.running ? '正在基于原始数据生成判断' : '分析已完成，看板已刷新';
  const startedMs = task.startedAt ? new Date(task.startedAt).getTime() : 0;
  const endedMs = task.finishedAt ? new Date(task.finishedAt).getTime() : Date.now();
  const elapsedLabel = startedMs ? formatDuration(Math.max(0, endedMs - startedMs)) : '—';
  const logLines = (task.log || '').trim().split(/\r?\n/).filter(Boolean).slice(-30);
  const logHtml = logLines.length
    ? logLines.map(line => `<span class="analyze-log-line">${escapeHtml(line)}</span>`).join('')
    : '<span class="analyze-log-empty">等待分析进程输出…</span>';
  return `<section class="analyze-panel ${tone}">
    <div class="analyze-panel-head">
      ${pill}
      <h2>${escapeHtml(heading)}</h2>
      <div class="analyze-meta">
        <span>开始：<strong>${escapeHtml(task.startedAt ? formatDateTime(task.startedAt) : '—')}</strong></span>
        <span>耗时：<strong>${escapeHtml(elapsedLabel)}</strong></span>
      </div>
    </div>
    ${task.running ? '<div class="analyze-progress-track"><div class="analyze-progress-bar"></div></div>' : ''}
    <div class="analyze-log">${logHtml}</div>
    ${task.error ? `<p style="margin-top:var(--space-sm);color:var(--red);font-size:12px;font-weight:600;">${escapeHtml(task.error)}</p>` : ''}
  </section>`;
}

function renderMarketPage() {
  if (!state.overview) return;
  const market = state.overview.market;
  $('#market-content').innerHTML = [
    renderAnalyzePanel(state.marketAnalyzeTask),
    renderMarketRawData(market),
    renderMarketAnalysis(market),
  ].join('');
  const analyzeButton = $('[data-analyze-market]');
  if (analyzeButton) {
    const busy = state.marketAnalyzeTask && state.marketAnalyzeTask.running;
    const collecting = state.collectTask && state.collectTask.running;
    analyzeButton.disabled = busy || collecting || (market && market.status === '待更新');
    analyzeButton.textContent = busy ? '分析中…' : 'AI 分析';
  }
  const collectButton = $('.page[data-page="market"] [data-collect="market"]');
  if (collectButton) collectButton.disabled = Boolean(state.marketAnalyzeTask && state.marketAnalyzeTask.running);
}

const REVIEW_BADGE = { pending: { label: '待复盘', cls: 'muted' }, correct: { label: '判断正确', cls: 'good' }, partial: { label: '部分正确', cls: 'pending' }, wrong: { label: '判断错误', cls: 'risk' } };

function renderDecisionReviewCard(data) {
  const r = data.judgment?.decisionReview;
  if (!r || r.total === 0) {
    return `<div class="record-card"><div class="record-copy"><p class="muted">还没有可供复盘的决策。生成日报或记录一次判断后，这里会展示近 ${90} 天的判断命中率与复盘完成度。</p></div></div>`;
  }
  const hit = r.hitRate == null ? '—' : `${r.hitRate}%`;
  const reviewPct = r.reviewRate == null ? '—' : `${r.reviewRate}%`;
  return `<div class="record-card">
    <div class="record-identity"><h3>决策复盘统计</h3><p class="decision-source">近 ${r.windowDays} 天 · 已复盘 ${r.reviewed}/${r.total}</p></div>
    <div class="record-numbers">
      <div><span>判断命中率</span><strong class="${r.hitRate == null ? '' : (r.hitRate >= 60 ? 'positive' : (r.hitRate < 40 ? 'negative' : ''))}">${hit}</strong></div>
      <div><span>复盘完成度</span><strong>${reviewPct}</strong></div>
      <div><span>待复盘</span><strong>${r.pending}</strong></div>
    </div>
    <div class="record-copy"><p><strong>正确 ${r.correct}</strong> · <strong>部分 ${r.partial}</strong> · <strong>错误 ${r.wrong}</strong>。命中率按「正确=1、部分=0.5」加权，复盘结论越早填写，越能避免「用结果反推过程」。</p></div>
  </div>`;
}

function renderDecisionRow(item) {
  const review = item.review_outcome && REVIEW_BADGE[item.review_outcome] ? REVIEW_BADGE[item.review_outcome] : REVIEW_BADGE.pending;
  return `<article class="decision-row">
    <div class="decision-date">${escapeHtml(item.decision_date)}</div>
    <div class="record-identity"><h3>${escapeHtml(item.title)}</h3><p class="decision-source">${escapeHtml(item.source_type)} · 数据充分度 ${Number(item.confidence || 0)}% <span class=\"status-pill ${review.cls}\">${escapeHtml(review.label)}</span></p></div>
    <dl class="decision-body"><div><dt>短期</dt><dd>${escapeHtml(item.short_term || '未记录')}</dd></div><div><dt>中期</dt><dd>${escapeHtml(item.mid_term || '未记录')}</dd></div><div><dt>行动</dt><dd>${escapeHtml(item.action || '未记录')}</dd></div><div><dt>风险</dt><dd>${escapeHtml(item.risk || '未记录')}</dd></div>${item.review_result ? `<div><dt>复盘</dt><dd>${escapeHtml(item.review_result)}</dd></div>` : ''}</dl>
    ${renderDecisionInput(item)}
    <div class="record-actions"><button class="button ghost small" data-edit-resource="decisions" data-record-id="${item.id}" type="button">复盘 / 编辑</button><button class="button ghost small" data-delete-resource="decisions" data-record-id="${item.id}" type="button">删除</button></div>
  </article>`;
}

// ─── 日报分析依据：展示生成时发送给模型服务的原始数据快照 ───
const SNAPSHOT_SECTION_LABELS = {
  account: '账户数据',
  market: '市场环境',
  holdings: '持仓明细',
  sectors: '关注板块',
  macro: '宏观变量',
  recentDecisions: '近期判断',
  videoEvidence: '视频观点',
  dataCompleteness: '数据充分度',
};

const SNAPSHOT_FIELD_LABELS = {
  totalAssets: '总资产', stockMarketValue: '股票市值', availableCash: '可用现金',
  accumulatedReturn: '累计收益', maxDrawdown: '最大回撤', annualTarget: '年度目标',
  status: '状态', risk_level: '风险等级', opportunity_level: '机会等级', score: '综合评分',
  strategy: '策略', current_value: '当前行情', change_note: '变化说明', observed_at: '数据日期',
  name: '名称', code: '代码', positionPct: '仓位%',
  buyLogic: '买入逻辑', thesisStatus: '逻辑状态',
  actionLevel: '行动等级', risk: '风险', rating: '评级', cycle: '周期',
  logic: '逻辑', title: '标题', sector: '板块', direction: '方向',
  mentionCount: '提及次数', totalVideos: '视频总数', latestDate: '最新日期',
};

function renderSnapshotRows(obj) {
  const entries = Object.entries(obj || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object')
    .map(([key, value]) => {
      const label = SNAPSHOT_FIELD_LABELS[key] || key;
      const text = Array.isArray(value) ? value.join('、') : String(value);
      return `<div class="decision-input-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>`;
    });
  return entries.length ? `<div class="decision-input-rows">${entries.join('')}</div>` : '';
}

function renderSnapshotItems(items, labelOf) {
  if (!Array.isArray(items) || !items.length) return '<p class="muted">无</p>';
  return `<div class="decision-input-items">${items.map((item) => `<div class="decision-input-item"><strong>${escapeHtml(labelOf(item))}</strong>${renderSnapshotRows(item)}</div>`).join('')}</div>`;
}

function renderSnapshotMarket(m) {
  if (!m) return '';
  const pick = {
    status: m.status,
    risk_level: m.risk_level,
    opportunity_level: m.opportunity_level,
    score: m.score,
    strategy: m.strategy,
    current_value: m.current_value,
    change_note: m.change_note,
    observed_at: m.observed_at,
  };
  return renderSnapshotRows(pick);
}

function renderSnapshotVideoEvidence(ve) {
  if (!ve) return '';
  const rows = [];
  if (ve.totalVideos != null) rows.push(`<div class="decision-input-row"><dt>视频总数</dt><dd>${escapeHtml(String(ve.totalVideos))}</dd></div>`);
  if (ve.latestDate) rows.push(`<div class="decision-input-row"><dt>最新日期</dt><dd>${escapeHtml(ve.latestDate)}</dd></div>`);
  if (Array.isArray(ve.sectors) && ve.sectors.length) {
    rows.push(`<div class="decision-input-row"><dt>板块方向</dt><dd>${escapeHtml(ve.sectors.map((x) => `${x.sector}（${x.direction}${x.mentionCount ? `·${x.mentionCount}次` : ''}）`).join('；'))}</dd></div>`);
  }
  if (Array.isArray(ve.recentVideos) && ve.recentVideos.length) {
    rows.push(`<div class="decision-input-row"><dt>近期视频</dt><dd>${escapeHtml(ve.recentVideos.map((v) => v.name).join('；'))}</dd></div>`);
  }
  return rows.length ? `<div class="decision-input-rows">${rows.join('')}</div>` : '';
}

function renderSnapshotSection(key, content) {
  if (!content) return '';
  return `<section class="decision-input-section"><h4>${escapeHtml(SNAPSHOT_SECTION_LABELS[key] || key)}</h4>${content}</section>`;
}

function renderDecisionInput(item) {
  if (item.decision_type !== 'daily_report') return '';
  if (!item.input_snapshot) {
    return `<div class="decision-input-wrap"><details class="decision-input"><summary>查看分析依据</summary><p class="muted">该日报生成时未保存输入数据快照；重新生成日报后，这里会展示生成时使用的原始数据。</p></details></div>`;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(item.input_snapshot);
  } catch {
    return '';
  }
  const sections = [
    renderSnapshotSection('account', renderSnapshotRows(snapshot.account)),
    renderSnapshotSection('market', renderSnapshotMarket(snapshot.market)),
    renderSnapshotSection('holdings', renderSnapshotItems(snapshot.holdings, (h) => `${h.name || ''}${h.code ? `（${h.code}）` : ''}`)),
    renderSnapshotSection('sectors', renderSnapshotItems(snapshot.sectors, (x) => x.name)),
    renderSnapshotSection('macro', renderSnapshotItems(snapshot.macro, (x) => x.name)),
    renderSnapshotSection('recentDecisions', renderSnapshotItems(snapshot.recentDecisions, (x) => x.title)),
    renderSnapshotSection('videoEvidence', renderSnapshotVideoEvidence(snapshot.videoEvidence)),
    renderSnapshotSection('dataCompleteness', snapshot.dataCompleteness != null
      ? `<div class="decision-input-rows"><div class="decision-input-row"><dt>数据充分度</dt><dd>${escapeHtml(String(snapshot.dataCompleteness))}%</dd></div></div>`
      : ''),
  ].join('');
  return `<div class="decision-input-wrap">
    <details class="decision-input">
      <summary>查看分析依据（生成时的原始数据）</summary>
      <div class="decision-input-sections">${sections || '<p class="muted">快照为空</p>'}</div>
      <details class="decision-input-raw"><summary>查看完整输入 JSON</summary><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></details>
    </details>
  </div>`;
}

function renderTradeRow(item) {
  const isSell = ['减仓', '卖出'].includes(item.trade_type);
  const hasRange = item.before_quantity || item.after_quantity;
  const quantityText = hasRange
    ? `原 ${formatMoney(item.before_quantity)} → 新 ${formatMoney(item.after_quantity)}`
    : `${isSell ? '-' : '+'}${formatMoney(item.quantity)}`;
  return `<article class="record-row compact">
    <div class="record-identity"><h3>${escapeHtml(item.stock_name)}</h3><p class="record-code">${escapeHtml(item.stock_code || '未填代码')} · ${escapeHtml(item.trade_date)}</p><span class="status-pill ${isSell ? 'risk' : 'good'}">${escapeHtml(item.trade_type)}</span></div>
    <div class="record-copy"><p><strong>数量变化：</strong>${quantityText}</p><p><strong>变更原因：</strong>${escapeHtml(item.reason || '未记录')}</p>${item.expectation ? `<p><strong>预期：</strong>${escapeHtml(item.expectation)}</p>` : ''}${item.risk ? `<p><strong>风险 / 情绪：</strong>${escapeHtml(item.risk)} · ${escapeHtml(item.emotion || '未记录')}</p>` : ''}${item.lesson ? `<p><strong>复盘：</strong>${escapeHtml(item.lesson)}</p>` : ''}</div>
    <div class="record-actions"><button class="button ghost small" data-delete-resource="trades" data-record-id="${item.id}" type="button">删除</button></div>
  </article>`;
}


function updateTradingDayUI() {
  const td = state.overview?.tradingDay;
  $$('[data-generate-report]').forEach(btn => {
    if (td && !td.today) {
      btn.disabled = true;
      btn.title = `今天不是交易日，下一交易日 ${formatTradingDate(td.next)}`;
    } else {
      btn.disabled = false;
      btn.title = '会将账户与投资记录摘要发送给你配置的模型服务';
    }
  });
}

function renderPages() {
  const data = state.overview;
  if (!data) return;
  renderOverview();
  renderMarketPage();
  renderFundamentals();
  const onlyPending = state.holdingFilter === 'pending';
  const visibleHoldings = onlyPending ? data.holdings.filter(h => h.thesis_status === '待确认' || !h.buy_logic) : data.holdings;
  const fundamentalsByCode = new Map((data.fundamentals || []).map(item => [String(item.stock_code), item]));
  // 「只看待确认」筛选下没有结果时，给出切回全部持仓的入口，避免页面停留在空列表
  const pendingFilterEmpty = onlyPending && !visibleHoldings.length && data.holdings.length
    ? `<div class="holdings-guide attention"><div><strong>没有待确认的持仓</strong><p>所有持仓的买入逻辑与逻辑状态都已确认。</p></div><button class="button small" data-holding-filter="all" type="button">显示全部持仓（${data.holdings.length}）</button></div>`
    : '';
  // 页面内用标签菜单分别展示持仓与关注，卡片样式统一（均含基本面）
  const tabs = renderPortfolioTabs(data.holdings, data.watchlist);
  const cardFor = item => renderPortfolioRow(item, fundamentalsByCode.get(String(item.stock_code)));
  const holdingTab = state.portfolioTab === 'holding';
  // 添加按钮跟随当前标签：持仓中只显示「添加持仓」，关注中只显示「添加观察标的」
  $('#holdings-heading-actions').innerHTML = `<button class="button" data-refresh-fundamentals type="button">刷新基本面</button><button class="button" data-refresh-quotes type="button">刷新行情</button>`
    + `<button class="button primary" data-open-form="${holdingTab ? 'holding' : 'watch'}" type="button">${holdingTab ? '添加持仓' : '添加观察标的'}</button>`;
  const holdingList = visibleHoldings.length
    ? `<div class="holding-ledger">${visibleHoldings.map(cardFor).join('')}</div>`
    : renderEmpty(
      data.holdings.length ? '没有待确认的持仓' : '还没有持仓',
      data.holdings.length ? '所有持仓的买入逻辑与逻辑状态都已确认。' : '录入第一只持仓后，这里会跟踪买入逻辑、行动条件与基本面。',
      '添加持仓', 'holding',
    );
  const watchList = data.watchlist.length
    ? `<div class="holding-ledger">${data.watchlist.map(cardFor).join('')}</div>`
    : renderEmpty('还没有关注标的', '添加候选标的与可验证的买入条件，等待触发后再转入持仓。', '添加观察标的', 'watch');
  $('#holdings-content').innerHTML = tabs + (holdingTab
    ? renderHoldingsGuide(data.holdings) + pendingFilterEmpty + holdingList
    : watchList);
  $('#sectors-content').innerHTML = renderSectorPages();
  renderMacroPage();
  const tradingNotice = data.tradingDay?.today ? '' : `<div class="trading-day-notice">今天不是交易日（下一交易日 ${escapeHtml(formatTradingDate(data.tradingDay.next))}），不会生成新日报；历史日报仍可复盘。</div>`;
  $('#decisions-content').innerHTML = tradingNotice + renderDecisionReviewCard(data) + (data.decisions.length ? `<div class="record-list">${data.decisions.map(renderDecisionRow).join('')}</div>` : renderEmpty('还没有日报', '生成每日 AI 日报后，可对其结论做复核：认可结论或事后标记正确/部分/错误。', '生成今日日报', 'daily-report'));
  $('#trades-content').innerHTML = data.trades.length ? `<div class="record-list">${data.trades.map(renderTradeRow).join('')}</div>` : renderEmpty('还没有持仓变更记录', '编辑持仓数量并填写变更原因后，系统会自动生成记录。');
  renderVideos();
}

function renderVideos() {
  const library = state.videoLibrary;
  if (!library) {
    $('#videos-content').innerHTML = `<div class="video-loading"><strong>${state.videoLibraryLoading ? '正在整理视频研究库…' : '视频研究库尚未载入'}</strong><span>正在读取观点方向、日期、原文与视频索引。</span></div>`;
    return;
  }

  const directionGroups = {
    bullish: library.sectors.filter(item => item.direction === '偏积极'),
    watch: library.sectors.filter(item => item.direction === '观察'),
    bearish: library.sectors.filter(item => item.direction === '偏谨慎'),
  };
  const directionColumn = (title, tone, items) => `
    <section class="video-direction-column ${tone}">
      <div class="video-direction-head"><h2>${title}</h2><span>${items.length} 个板块</span></div>
      <div class="video-signal-list">${items.length
        ? items.map(item => `<article class="video-signal"><strong>${escapeHtml(item.sector)}</strong>${item.mentionCount ? `<span class="video-signal-count">${item.mentionCount}</span>` : ''}</article>`).join('')
        : '<p class="video-signal-empty">当前没有归入这一方向的板块观点。</p>'}
      </div>
    </section>`;
  const dateGroups = library.videos.reduce((groups, video) => {
    if (!groups[video.date]) groups[video.date] = [];
    groups[video.date].push(video);
    return groups;
  }, {});
  const dates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));
  if (!dates.includes(state.currentVideoDate)) state.currentVideoDate = dates[0] || '';
  const selectedVideos = dateGroups[state.currentVideoDate] || [];
  const videoItem = video => `
    <article class="video-research-item">
      <div class="video-research-summary">
        <div class="video-research-title">
          <h3>${escapeHtml(video.name)}</h3>
          <a class="button small" href="/videos/${encodeURIComponent(video.name)}" target="_blank" rel="noopener">原视频 ↗</a>
        </div>
        <section class="video-research-section">
          <h4>观点</h4>
          ${video.viewpoints.length
            ? `<ul class="video-viewpoints">${video.viewpoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`
            : '<p class="muted">这条视频尚未生成提炼观点。</p>'}
        </section>
      </div>
      <section class="video-research-section">
        <h4>原文（语音转文字）</h4>
        <div class="video-transcript">${escapeHtml(video.transcript || '这条视频尚无转写原文。')}</div>
      </section>
    </article>`;
  const startedMs = state.analyzeTask?.startedAt ? new Date(state.analyzeTask.startedAt).getTime() : 0;
  const endedMs = state.analyzeTask?.finishedAt ? new Date(state.analyzeTask.finishedAt).getTime() : Date.now();
  const elapsedLabel = startedMs ? formatDuration(Math.max(0, endedMs - startedMs)) : '—';
  const analyzePanel = () => {
    const task = state.analyzeTask;
    if (!task || (!task.running && !task.finishedAt && !task.lastStatus)) return '';
    // 服务重启后内存状态丢失：展示上次运行结果，提醒用户任务可能已中断
    const interrupted = !task.running && !task.finishedAt && task.lastStatus === 'failed'
      && String(task.lastSummary || '').includes('服务重启');
    const tone = task.error ? 'failed' : (task.running ? 'running' : (interrupted ? 'failed' : 'done'));
    const pill = task.error
      ? '<span class="analyze-status-pill">分析失败</span>'
      : task.running
        ? '<span class="analyze-status-pill"><span class="analyze-spinner"></span>正在分析</span>'
        : interrupted
          ? '<span class="analyze-status-pill">上次分析被中断</span>'
          : '<span class="analyze-status-pill">已完成</span>';
    const heading = task.error ? '视频分析过程中出错' : task.running ? '正在分析新视频' : interrupted ? '上次分析因服务重启而中断' : '视频分析已完成，研究库已更新';
    const logLines = (task.log || '').trim().split(/\r?\n/).filter(Boolean).slice(-30);
    const logHtml = logLines.length
      ? logLines.map(line => `<span class="analyze-log-line">${escapeHtml(line)}</span>`).join('')
      : interrupted
        ? '<span class="analyze-log-empty">上次分析未完成：服务在分析过程中被重启，任务已中断。请重新点击“分析新视频”。</span>'
        : '<span class="analyze-log-empty">等待分析进程输出…</span>';
    return `<section class="analyze-panel ${tone}">
      <div class="analyze-panel-head">
        ${pill}
        <h2>${escapeHtml(heading)}</h2>
        <div class="analyze-meta">
          <span>开始：<strong>${escapeHtml(task.startedAt ? formatDateTime(task.startedAt) : (task.lastRunAt ? formatDateTime(task.lastRunAt) : '—'))}</strong></span>
          <span>耗时：<strong>${escapeHtml(elapsedLabel)}</strong></span>
        </div>
      </div>
      ${task.running ? '<div class="analyze-progress-track"><div class="analyze-progress-bar"></div></div>' : ''}
      <div class="analyze-log" id="analyze-log-box">${logHtml}</div>
      ${task.error ? `<p style="margin-top:var(--space-sm);color:var(--red);font-size:12px;font-weight:600;">${escapeHtml(task.error)}</p>` : ''}
      ${interrupted ? `<p style="margin-top:var(--space-sm);color:var(--amber);font-size:12px;font-weight:600;">${escapeHtml(task.lastSummary || '')}</p>` : ''}
    </section>`;
  };
  $('#videos-content').innerHTML = `
    ${analyzePanel()}
    <div class="video-direction-board">
      ${directionColumn('看多', 'good', directionGroups.bullish)}
      ${directionColumn('观察', 'pending', directionGroups.watch)}
      ${directionColumn('看空', 'risk', directionGroups.bearish)}
    </div>
    <section class="video-timeline">
      <div class="section-head"><div><h2>按日期查看</h2><p class="muted">共 ${library.totalVideos} 条视频，最新日期排在最左侧</p></div><div class="heading-actions"><button class="button small" data-analyze-videos type="button"${state.analyzeTask?.running ? ' disabled' : ''}>${state.analyzeTask?.running ? '正在分析…' : '分析新视频'}</button><small>研究库更新于 ${escapeHtml(formatDateTime(library.generatedAt))}</small></div></div>
      <div class="video-date-rail" role="tablist" aria-label="视频日期">
        ${dates.map(date => `<button class="video-date-tab${date === state.currentVideoDate ? ' active' : ''}" data-video-date="${escapeHtml(date)}" type="button" role="tab" aria-selected="${date === state.currentVideoDate}">${escapeHtml(date)}<span>${dateGroups[date].length}</span></button>`).join('')}
      </div>
      <div class="video-day-heading"><div><h2>${escapeHtml(state.currentVideoDate || '暂无日期')}</h2><p>${selectedVideos.length} 条视频分析</p></div><p>原文来自语音转写，请结合原视频复核</p></div>
      <div class="video-day-list">${selectedVideos.length ? selectedVideos.map(videoItem).join('') : renderEmpty('当天没有视频', '选择其他日期查看对应的视频分析。')}</div>
    </section>`;
}

const TASK_STATUS_LABELS = { running: '运行中', success: '已完成', failed: '失败', '': '待运行' };

function taskStatusClass(status) {
  if (status === 'success') return 'good';
  if (status === 'failed') return 'risk';
  return 'pending';
}

function fmtTaskTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderTaskCard(t) {
  const statusText = TASK_STATUS_LABELS[t.lastStatus] || TASK_STATUS_LABELS[''];
  const statusLabel = t.running ? '运行中' : statusText;
  const statusClass = t.running ? 'pending' : taskStatusClass(t.lastStatus);
  const nextRun = t.running ? '运行中…' : fmtTaskTime(t.nextRunAt);
  const lastRun = t.lastRunAt ? fmtTaskTime(t.lastRunAt) : '尚未运行';
  const durationText = t.lastDurationMs ? ` · 耗时 ${formatDuration(t.lastDurationMs)}` : '';
  return `<article class="task-card">
    <header class="task-card-head">
      <div><h2>${escapeHtml(t.title)}</h2><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></div>
      <button class="button small" data-run-task="${escapeHtml(t.key)}" type="button" ${t.running ? 'disabled' : ''}>立即运行</button>
    </header>
    <p class="task-card-desc">${escapeHtml(t.description)}</p>
    <dl class="task-card-meta">
      <div><dt>计划</dt><dd>${escapeHtml(t.scheduleText)}</dd></div>
      <div><dt>下次运行</dt><dd>${escapeHtml(nextRun)}</dd></div>
      <div><dt>上次运行</dt><dd>${escapeHtml(lastRun)}${escapeHtml(durationText)}</dd></div>
      <div><dt>最近结果</dt><dd class="${t.lastStatus === 'failed' ? 'risk' : ''}">${escapeHtml(t.lastSummary || '—')}</dd></div>
    </dl>
  </article>`;
}

function renderTasks() {
  const target = $('#tasks-content');
  if (state.tasksLoading && !state.tasks) {
    target.innerHTML = '<div class="operation-loading"><span></span><div><strong>正在读取定时任务</strong><p>任务由看板服务统一调度，服务运行期间自动执行。</p></div></div>';
    return;
  }
  const payload = state.tasks;
  if (!payload) {
    target.innerHTML = renderEmpty('定时任务尚未载入', '刷新后可查看服务内置任务的运行状态。');
    return;
  }
  const tasks = payload.tasks || [];
  const runningCount = tasks.filter(t => t.running).length;
  const failedCount = tasks.filter(t => t.lastStatus === 'failed').length;
  target.innerHTML = `
    <section class="operation-overview" aria-label="定时任务概览">
      <div><span>任务总数</span><strong>${tasks.length}</strong></div>
      <div><span>正在运行</span><strong>${runningCount}</strong></div>
      <div><span>上次失败</span><strong class="${failedCount ? 'risk' : ''}">${failedCount}</strong></div>
      <p>服务重启后自动按计划恢复：工作日 16:10 全量采集，每天 23:30 备份数据库。</p>
    </section>
    <div class="task-grid">${tasks.map(renderTaskCard).join('')}</div>`;
}

async function loadTasks(force = false) {
  if (state.tasksLoading) return;
  state.tasksLoading = true;
  if (force) state.tasks = null;
  renderTasks();
  try {
    state.tasks = await api('/api/investment/tasks');
    renderTasks();
    clearTimeout(state.tasksPollTimer);
    const anyRunning = state.tasks.tasks?.some(t => t.running);
    if (state.currentPage === 'tasks' && anyRunning) {
      state.tasksPollTimer = setTimeout(() => loadTasks(), 3000);
    }
  } catch (error) {
    $('#tasks-content').innerHTML = renderEmpty('无法读取定时任务', error.message);
    notify(error.message, 'error');
  } finally {
    state.tasksLoading = false;
  }
}

async function runTaskNow(key) {
  try {
    const result = await api(`/api/investment/tasks/${encodeURIComponent(key)}/run`, { method: 'POST', body: '{}' });
    if (result.ok) notify(result.summary || '任务已触发');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    loadTasks(true);
  }
}

const OPERATION_CATEGORY_LABELS = {
  collection: '数据采集',
  video: '视频研究',
  analysis: '综合分析',
  system: '系统任务',
};

function renderOperationLogs() {
  const target = $('#operations-content');
  if (state.operationLogsLoading && !state.operationLogs) {
    target.innerHTML = '<div class="operation-loading"><span></span><div><strong>正在读取运行记录</strong><p>日志保存在本地投资数据库中。</p></div></div>';
    return;
  }
  const payload = state.operationLogs;
  if (!payload) {
    target.innerHTML = renderEmpty('运行日志尚未载入', '刷新后可查看系统任务的执行记录。');
    return;
  }
  const allItems = payload.items || [];
  const filter = state.operationLogFilter;
  const items = filter === 'all'
    ? allItems
    : allItems.filter(item => item.category === filter || item.status === filter);
  const summary = {
    total: allItems.length,
    running: allItems.filter(item => item.status === 'running').length,
    success: allItems.filter(item => item.status === 'success').length,
    failed: allItems.filter(item => item.status === 'failed').length,
  };
  const filterButton = (value, label, count = '') => `<button class="operation-filter${filter === value ? ' active' : ''}" data-log-filter="${value}" type="button">${label}${count !== '' ? `<span>${count}</span>` : ''}</button>`;
  const statusLabel = { running: '进行中', success: '已完成', failed: '失败' };
  const duration = item => item.status === 'running'
    ? formatDuration(Math.max(0, Date.now() - new Date(item.started_at).getTime()))
    : formatDuration(item.duration_ms || 0);
  const row = item => {
    const started = new Date(item.started_at);
    const validDate = !Number.isNaN(started.getTime());
    const date = validDate ? started.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '—';
    const time = validDate ? started.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
    const details = (item.details || '').trim();
    return `<article class="operation-row ${item.status}">
      <time class="operation-time" datetime="${escapeHtml(item.started_at)}"><strong>${escapeHtml(time)}</strong><span>${escapeHtml(date)}</span></time>
      <div class="operation-state" aria-label="${escapeHtml(statusLabel[item.status] || item.status)}"><span></span>${escapeHtml(statusLabel[item.status] || item.status)}</div>
      <div class="operation-main">
        <div class="operation-title"><h2>${escapeHtml(item.title)}</h2><span>${escapeHtml(OPERATION_CATEGORY_LABELS[item.category] || item.category)}</span></div>
        <p>${escapeHtml(item.summary || '暂无执行摘要')}</p>
        ${details ? `<details class="operation-details"><summary>查看原始输出</summary><pre>${escapeHtml(details)}</pre></details>` : ''}
      </div>
      <div class="operation-duration"><span>耗时</span><strong>${escapeHtml(duration(item))}</strong></div>
    </article>`;
  };
  target.innerHTML = `
    <section class="operation-overview" aria-label="日志概览">
      <div><span>最近记录</span><strong>${summary.total}</strong></div>
      <div><span>正在运行</span><strong>${summary.running}</strong></div>
      <div><span>执行失败</span><strong class="${summary.failed ? 'risk' : ''}">${summary.failed}</strong></div>
      <p>自动保留最近 100 条任务记录；展开单条记录可查看进程原始输出。</p>
    </section>
    <div class="operation-toolbar" role="group" aria-label="筛选运行日志">
      ${filterButton('all', '全部', summary.total)}
      ${filterButton('running', '进行中', summary.running)}
      ${filterButton('failed', '失败', summary.failed)}
      ${filterButton('collection', '数据采集')}
      ${filterButton('video', '视频研究')}
      ${filterButton('analysis', '综合分析')}
    </div>
    ${items.length ? `<div class="operation-ledger">${items.map(row).join('')}</div>` : renderEmpty('没有符合条件的日志', '切换筛选条件查看其他运行记录。')}`;
}

async function loadOperationLogs(force = false) {
  if (state.operationLogsLoading) return;
  state.operationLogsLoading = true;
  if (force) state.operationLogs = null;
  renderOperationLogs();
  try {
    state.operationLogs = await api('/api/investment/operation-logs?limit=100');
    renderOperationLogs();
    clearTimeout(state.operationLogPollTimer);
    if (state.currentPage === 'operations' && state.operationLogs.items?.some(item => item.status === 'running')) {
      state.operationLogPollTimer = setTimeout(() => loadOperationLogs(), 2500);
    }
  } catch (error) {
    $('#operations-content').innerHTML = renderEmpty('无法读取运行日志', error.message);
    notify(error.message, 'error');
  } finally {
    state.operationLogsLoading = false;
  }
}

function findRecord(resource, id) {
  const data = state.overview;
  const pools = {
    portfolio: [...data.holdings, ...data.watchlist],
    sectors: data.sectors,
    market: [data.account, data.market, ...data.macro].filter(Boolean),
    decisions: data.decisions,
    trades: data.trades,
  };
  return pools[resource]?.find(item => Number(item.id) === Number(id));
}

function configKeyForRecord(resource, record) {
  if (resource === 'portfolio') return record.list_type === 'watch' ? 'watch' : 'holding';
  if (resource === 'market') return record.record_type;
  if (resource === 'sectors') return 'sector';
  if (resource === 'decisions') return 'decision';
  return '';
}

function fieldValue(record, name) {
  if (name.startsWith('metric__')) return record?.metrics?.[name.slice('metric__'.length)] ?? '';
  return record?.[name] ?? '';
}

function renderField(field, record) {
  const [name, label, type, required, extra] = field;
  let value = fieldValue(record, name);
  // 成本金额回显固定两位小数（17109.2 → 17109.20），输入小数不会“看起来被吞”
  if ((name === 'cost_amount' || name === 'cost_price') && value !== '' && value != null) value = Number(value).toFixed(2);
  const full = type === 'textarea' ? ' full' : '';
  const requiredAttr = required ? ' required' : '';
  const placeholder = typeof extra === 'string' ? ` placeholder="${escapeHtml(extra)}"` : '';
  let control;
  if (type === 'textarea') {
    control = `<textarea id="field-${name}" name="${name}"${requiredAttr}${placeholder}>${escapeHtml(value)}</textarea>`;
  } else if (type === 'select') {
    const optionLabels = { stock: 'A股股票', fund: '场内基金 / ETF', pending: '待复盘', correct: '判断正确', partial: '部分正确', wrong: '判断错误' };
    control = `<select id="field-${name}" name="${name}"${requiredAttr}>${(extra || []).map(option => `<option value="${escapeHtml(option)}"${String(value) === String(option) ? ' selected' : ''}>${escapeHtml(optionLabels[option] || option)}</option>`).join('')}</select>`;
  } else {
    const step = type === 'number' ? ' step="any"' : '';
    control = `<input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"${requiredAttr}${placeholder}${step}>`;
  }
  return `<div class="field${full}"><label for="field-${name}">${escapeHtml(label)}${required ? ' *' : ''}</label>${control}</div>`;
}

function openEditor(configKey, record = null, options = {}) {
  const config = formConfigs[configKey];
  if (!config) return;
  const prefill = options.prefill === true;
  state.editor = {
    configKey,
    resource: config.resource,
    id: prefill ? null : (record?.id || null),
    sourceWatchId: options.sourceWatchId || null,
  };
  $('#dialog-title').textContent = `${record ? '编辑' : '添加'}${config.title}`;
  $('#dialog-error').hidden = true;
  $('#dialog-subtitle').textContent = config.subtitle;
  const fields = config.fields;
  if (configKey === 'holding' && !record) {
    // 新增持仓没有“变更”可言，隐藏变更原因字段
    state.hideChangeReasonField = true;
  } else {
    state.hideChangeReasonField = false;
  }
  const visibleFields = state.hideChangeReasonField
    ? fields.filter(field => field[0] !== 'change_reason')
    : fields;
  $('#form-fields').innerHTML = visibleFields.map(field => renderField(field, record)).join('');
  $('#record-dialog').showModal();
  setTimeout(() => $('#form-fields input, #form-fields select, #form-fields textarea')?.focus(), 30);
}

function openWatchToHolding(watchId) {
  const record = state.overview?.watchlist?.find(item => Number(item.id) === Number(watchId));
  if (!record) {
    notify('找不到这条关注记录', 'error');
    return;
  }
  openEditor('holding', record, { prefill: true, sourceWatchId: Number(watchId) });
  $('#dialog-subtitle').textContent = '从关注列表转入持仓：已带出代码、逻辑与买入条件，补充成本价和数量后保存，原关注记录会自动移除。';
}

function showDialogError(message) {
  const box = $('#dialog-error');
  box.textContent = message;
  box.hidden = false;
}

function serializeEditor() {
  const config = formConfigs[state.editor.configKey];
  const formData = new FormData($('#record-form'));
  const payload = { ...(config.preset || {}) };
  const metrics = { ...(state.editor.id ? findRecord(state.editor.resource, state.editor.id)?.metrics : {}) };
  for (const [name, value] of formData.entries()) {
    if (name.startsWith('metric__')) {
      const metricName = name.slice('metric__'.length);
      metrics[metricName] = value === '' ? 0 : (Number.isFinite(Number(value)) ? Number(value) : value);
    } else {
      payload[name] = value;
    }
  }
  if (config.fields.some(field => field[0].startsWith('metric__'))) payload.metrics_json = metrics;
  delete payload.position_pct; // 仓位由后端按成本价格 × 数量自动计算
  return payload;
}

async function saveEditor(event) {
  event.preventDefault();
  if (!state.editor) return;
  const button = $('#save-button');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    const payload = serializeEditor();
    if (state.editor.resource === 'portfolio' && state.editor.id) {
      const record = findRecord('portfolio', state.editor.id);
      const nextQuantity = Number(payload.quantity);
      if (record?.list_type === 'holding' && Number.isFinite(nextQuantity)
        && nextQuantity !== Number(record.quantity)
        && !String(payload.change_reason || '').trim()) {
        showDialogError('持仓数量变化时必须填写变更原因');
        button.disabled = false;
        button.textContent = '保存记录';
        return;
      }
    }
    const path = `/api/investment/${state.editor.resource}${state.editor.id ? `/${state.editor.id}` : ''}`;
    await api(path, { method: state.editor.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#record-dialog').close();
    const sourceWatchId = state.editor.sourceWatchId;
    if (sourceWatchId) {
      state.portfolioTab = 'holding';
      try {
        await api(`/api/investment/portfolio/${sourceWatchId}`, { method: 'DELETE' });
        notify('已保存持仓，原关注记录已移除');
      } catch {
        notify('已保存持仓，但原关注记录移除失败，可手动删除');
      }
    } else {
      notify('记录已保存');
    }
    await loadOverview();
  } catch (error) {
    showDialogError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '保存记录';
  }
}

function requestDelete(resource, id) {
  const record = findRecord(resource, id);
  if (!record) return;
  state.pendingDelete = { resource, id };
  $('#confirm-copy').textContent = `即将删除“${record.stock_name || record.name || record.title || '这条记录'}”。投资业务记录会从本地数据库移除。`;
  $('#confirm-dialog').showModal();
}

async function confirmDelete() {
  if (!state.pendingDelete) return;
  const { resource, id } = state.pendingDelete;
  try {
    await api(`/api/investment/${resource}/${id}`, { method: 'DELETE' });
    $('#confirm-dialog').close();
    state.pendingDelete = null;
    notify('记录已删除');
    await loadOverview();
  } catch (error) {
    notify(error.message, 'error');
  }
}

function snapshotReviewTasks() {
  return (state.overview?.judgment?.reviewTasks || []).map(item => ({
    ...item,
    status: 'pending',
    note: '',
    updatedAt: '',
  }));
}

async function saveReview(patch = {}, render = true) {
  if (state.reviewSaving) return state.review;
  state.reviewSaving = true;
  try {
    const base = state.review || {
      review_date: currentReviewDate(),
      status: 'in_progress',
      current_step: 1,
      items: snapshotReviewTasks(),
      summary_note: '',
    };
    state.review = await api('/api/investment/daily-review', {
      method: 'PUT',
      body: JSON.stringify({ ...base, ...patch }),
    });
    const recentIndex = state.recentReviews.findIndex(item => item.review_date === state.review.review_date);
    if (recentIndex >= 0) state.recentReviews.splice(recentIndex, 1, state.review);
    else state.recentReviews.unshift(state.review);
    state.recentReviews = state.recentReviews.slice(0, 7);
    if (render) renderOverview();
    return state.review;
  } catch (error) {
    notify(`没有保存今日复盘：${error.message}`, 'error');
    throw error;
  } finally {
    state.reviewSaving = false;
  }
}

async function startReview() {
  await saveReview({
    review_date: currentReviewDate(),
    status: 'in_progress',
    current_step: 1,
    items: snapshotReviewTasks(),
  });
  notify('今日复盘已开始');
}

async function advanceReview(step) {
  const nextStep = Number(step);
  if (nextStep === 3 && state.review?.items?.some(item => item.status === 'pending')) {
    notify('请先为每个行动项选择处理方式', 'error');
    return;
  }
  await saveReview({ current_step: nextStep });
}

async function updateReviewTask(key, status) {
  const items = (state.review?.items || []).map(item => {
    if (item.key !== key) return item;
    const noteField = $$('[data-review-note]').find(field => field.dataset.reviewNote === key);
    return {
      ...item,
      status,
      note: noteField?.value.trim() || item.note || '',
      updatedAt: new Date().toISOString(),
    };
  });
  await saveReview({ items });
}

async function saveReviewTaskNote(key, note) {
  const items = (state.review?.items || []).map(item => (
    item.key === key ? { ...item, note: note.trim(), updatedAt: new Date().toISOString() } : item
  ));
  await saveReview({ items }, false);
}

async function completeReview() {
  const summary = $('#review-summary-note')?.value.trim() || state.review?.summary_note || '';
  await saveReview({
    status: 'completed',
    current_step: 3,
    summary_note: summary,
    completed_at: new Date().toISOString(),
  });
  notify('今日复盘已完成，可以放心离开');
}

async function reopenReview() {
  await saveReview({ status: 'in_progress', current_step: 3, completed_at: '' });
  notify('已重新打开今日复盘');
}

async function generateReport(button) {
  const buttons = $$('[data-generate-report]');
  buttons.forEach(item => { item.disabled = true; item.textContent = '正在综合分析…'; });
  try {
    const fromReview = button?.hasAttribute('data-review-report');
    if (fromReview && state.review) {
      await saveReview({ summary_note: $('#review-summary-note')?.value.trim() || '' }, false);
    }
    const result = await api('/api/investment/daily-analysis', { method: 'POST', body: '{}' });
    const suffix = result.fallbackReason ? `；模型不可用，已使用规则辅助：${result.fallbackReason}` : '';
    notify(`日报已生成（${result.mode}）${suffix}`);
    await loadOverview();
    if (!fromReview) switchPage('decisions');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    buttons.forEach(item => { item.disabled = false; item.textContent = item === button && state.currentPage === 'decisions' ? '生成今日日报' : (item.closest('.section-head') ? '重新生成' : '生成今日日报'); });
  }
}

function switchPage(page) {
  if (!pageLabels[page]) return;
  state.currentPage = page;
  $$('[data-page]').forEach(section => { section.hidden = section.dataset.page !== page; });
  $$('[data-page-target]').forEach(button => button.classList.toggle('active', button.dataset.pageTarget === page && button.classList.contains('nav-button')));
  const activeNavButton = $(`.nav-button[data-page-target="${page}"]`);
  if (activeNavButton && window.matchMedia('(max-width: 820px)').matches) {
    activeNavButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  $('#current-page-label').textContent = pageLabels[page];
  $('#global-report-button').hidden = page !== 'decisions';
  history.replaceState(null, '', `#${page}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'videos') loadVideoLibrary();
  if (page === 'macro') loadGoldMarket();
  if (page === 'operations') loadOperationLogs();
  if (page === 'tasks') loadTasks(true);
  if (page !== 'operations') {
    clearTimeout(state.operationLogPollTimer);
    state.operationLogPollTimer = null;
  }
  if (page !== 'tasks') {
    clearTimeout(state.tasksPollTimer);
    state.tasksPollTimer = null;
  }
}

async function loadGoldMarket(force = false) {
  if (state.goldMarketLoading) return;
  state.goldMarketLoading = true;
  renderMacroPage();
  try {
    state.goldMarket = await api('/api/investment/gold/refresh', {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
    await loadOverview();
    notify(force ? '黄金行情已更新' : '黄金行情已同步');
  } catch (error) {
    notify(error.message, 'error');
    renderMacroPage();
  } finally {
    state.goldMarketLoading = false;
    renderMacroPage();
  }
}

async function refreshFundamentalsPanel() {
  if (state.fundamentalsLoading) return;
  state.fundamentalsLoading = true;
  renderFundamentals();
  try {
    const result = await api('/api/investment/stock-fundamentals/refresh', { method: 'POST', body: JSON.stringify({}) });
    await loadOverview();
    const ok = result.results?.length || 0;
    const failed = result.errors?.length || 0;
    if (failed) notify(`已采集 ${ok} 只，${failed} 只失败：${result.errors.map(e => `${e.stock_code}(${e.message})`).join('；')}`, 'error');
    else notify(`已更新 ${ok} 只股票的基本面`);
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    state.fundamentalsLoading = false;
    renderFundamentals();
  }
}

async function refreshQuotesPanel() {
  try {
    const result = await api('/api/investment/quotes/refresh', { method: 'POST', body: JSON.stringify({}) });
    await loadOverview();
    const ok = result.results?.length || 0;
    const failed = result.errors?.length || 0;
    if (failed) notify(`已更新 ${ok} 只行情，${failed} 只失败：${result.errors.map(e => `${e.stock_code}(${e.message})`).join('；')}`, 'error');
    else notify(`已更新 ${ok} 只股票的最新行情`);
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function loadVideoLibrary(force = false) {
  if (state.videoLibraryLoading || (state.videoLibrary && !force)) return;
  state.videoLibraryLoading = true;
  renderVideos();
  try {
    state.videoLibrary = await api('/api/investment/video-evidence');
    renderVideos();
  } catch (error) {
    $('#videos-content').innerHTML = renderEmpty('无法加载视频研究库', `${error.message}。请确认报告数据已生成。`);
    notify(error.message, 'error');
  } finally {
    state.videoLibraryLoading = false;
  }
}

// 轮询分析任务进度
async function pollAnalyzeTask() {
  const previous = state.analyzeTask;
  try {
    state.analyzeTask = await api('/api/investment/analyze-videos');
    pollSucceeded('analyze');
  } catch (error) {
    pollFailed('analyze'); // 查询失败：退避后下次再试
  }
  if (state.currentPage === 'videos') {
    renderVideos();
    const logBox = $('#analyze-log-box');
    if (logBox) logBox.scrollTop = logBox.scrollHeight;
  }
  if (state.analyzeTask && state.analyzeTask.running) {
    state.analyzePollTimer = setTimeout(pollAnalyzeTask, pollInterval(1200, 'analyze'));
  } else if (state.analyzeTask && state.analyzeTask.finishedAt && !state.analyzeTask.error) {
    // 任务完成且成功：刷新研究库
    state.analyzePollTimer = null;
    if (state.currentPage === 'videos') {
      notify('视频分析已完成，研究库已更新');
      await loadVideoLibrary(true);
    }
  } else if (previous && previous.running && state.analyzeTask && !state.analyzeTask.finishedAt) {
    // 任务从运行中变为“消失”（服务重启导致内存状态丢失）：提示并刷新研究库
    state.analyzePollTimer = null;
    notify('分析任务已中断（服务可能在分析期间被重启），研究库已刷新，可重新分析', 'error');
    if (state.currentPage === 'videos') await loadVideoLibrary(true);
  } else {
    state.analyzePollTimer = null;
  }
}

async function startAnalyzeVideos() {
  if (state.analyzeTask && state.analyzeTask.running) return;
  if (!confirm('将分析 videos/ 中尚未转写的新视频（会调用阿里云 NLS 与 LLM）。\n确认开始？')) return;
  try {
    await api('/api/investment/analyze-videos', { method: 'POST', body: '{}' });
    notify('已开始分析新视频，请稍候');
    state.analyzeTask = { running: true, startedAt: new Date().toISOString(), log: '', finishedAt: null, error: null };
    renderVideos();
    pollAnalyzeTask();
  } catch (error) {
    notify(error.message, 'error');
  }
}

// 采集任务进度轮询
const COLLECT_LABELS = { macro: '宏观变量', market: 'A 股市场环境', sector: '板块行情', all: '全部行情' };

async function pollCollectTask() {
  try {
    state.collectTask = await api('/api/investment/collect');
    pollSucceeded('collect');
  } catch (error) {
    pollFailed('collect'); // 查询失败：退避后下次再试
  }
  updateCollectButtons();
  if (state.collectTask && state.collectTask.running) {
    state.collectPollTimer = setTimeout(pollCollectTask, pollInterval(1500, 'collect'));
  } else if (state.collectTask && state.collectTask.finishedAt) {
    state.collectPollTimer = null;
    const task = state.collectTask;
    if (task.error) {
      notify(`${COLLECT_LABELS[task.scope] || '采集'}失败：${task.error}`, 'error');
    } else {
      notify(`${COLLECT_LABELS[task.scope] || '采集'}已完成`);
    }
    // 采集完成后刷新当前页数据
    await loadOverview();
    renderPages();
  } else {
    state.collectPollTimer = null;
  }
}

function updateCollectButtons() {
  const running = state.collectTask && state.collectTask.running;
  const analyzing = (state.marketAnalyzeTask && state.marketAnalyzeTask.running) || (state.sectorAnalyzeTask && state.sectorAnalyzeTask.running);
  const runningScope = running ? state.collectTask.scope : null;
  $$('[data-collect]').forEach(btn => {
    const scope = btn.dataset.collect;
    if (running) {
      btn.disabled = true;
      btn.textContent = runningScope === scope ? `采集中…` : (runningScope === 'all' ? '采集中…' : COLLECT_LABELS[scope] || '采集');
    } else if (analyzing) {
      btn.disabled = true;
      btn.textContent = '分析中…';
    } else {
      btn.disabled = false;
      btn.textContent = ({ all: '一键采集行情', macro: '采集宏观行情', market: '采集市场', sector: '采集板块行情' })[scope] || '采集';
    }
  });
}

async function startCollect(scope) {
  if (state.collectTask && state.collectTask.running) {
    notify(`已有采集任务（${COLLECT_LABELS[state.collectTask.scope]}）正在进行`, 'error');
    return;
  }
  const hint = scope === 'all'
    ? '将按宏观 → 市场 → 板块顺序采集行情（需要 CDP Proxy 运行）。确认开始？'
    : `将采集${COLLECT_LABELS[scope]}行情。确认开始？`;
  if (!confirm(hint)) return;
  try {
    await api(`/api/investment/collect/${scope}`, { method: 'POST', body: '{}' });
    state.collectTask = { running: true, scope, startedAt: new Date().toISOString(), log: '', finishedAt: null, error: null };
    updateCollectButtons();
    pollCollectTask();
  } catch (error) {
    notify(error.message, 'error');
  }
}

// 市场环境 AI 分析任务进度轮询（与视频分析 state.analyzeTask 相互独立）
async function pollMarketAnalyzeTask() {
  try {
    state.marketAnalyzeTask = await api('/api/investment/analyze');
    pollSucceeded('marketAnalyze');
  } catch (error) {
    pollFailed('marketAnalyze'); // 查询失败：退避后下次再试
  }
  updateCollectButtons();
  renderMarketPage();
  if (state.marketAnalyzeTask && state.marketAnalyzeTask.running) {
    state.marketAnalyzePollTimer = setTimeout(pollMarketAnalyzeTask, pollInterval(1500, 'marketAnalyze'));
  } else if (state.marketAnalyzeTask && state.marketAnalyzeTask.finishedAt) {
    state.marketAnalyzePollTimer = null;
    const task = state.marketAnalyzeTask;
    if (task.error) {
      notify(`市场环境分析失败：${task.error}`, 'error');
    } else {
      notify('市场环境 AI 分析已完成，原始数据与结论已分开保存');
    }
    await loadOverview();
    renderPages();
  } else {
    state.marketAnalyzePollTimer = null;
  }
}

async function startMarketAnalyze() {
  if (state.marketAnalyzeTask && state.marketAnalyzeTask.running) {
    notify('已有市场环境分析任务正在进行', 'error');
    return;
  }
  const market = state.overview?.market;
  if (!market || market.status === '待更新') {
    notify('请先点击「采集市场」获取行情数据，再进行 AI 分析', 'error');
    return;
  }
  if (!confirm('将把上方「原始行情数据」发送给你配置的模型服务，生成风险/机会等级与策略。确认开始？')) return;
  try {
    await api('/api/investment/analyze/market', { method: 'POST', body: '{}' });
    state.marketAnalyzeTask = { running: true, scope: 'market', startedAt: new Date().toISOString(), log: '', finishedAt: null, error: null };
    updateCollectButtons();
    renderMarketPage();
    pollMarketAnalyzeTask();
  } catch (error) {
    notify(error.message, 'error');
  }
}

// 板块 AI 参考分析任务进度轮询
async function pollSectorAnalyzeTask() {
  try {
    state.sectorAnalyzeTask = await api('/api/investment/analyze/sector');
    pollSucceeded('sectorAnalyze');
  } catch (error) {
    pollFailed('sectorAnalyze'); // 查询失败：退避后下次再试
  }
  updateCollectButtons();
  renderSectorPages();
  if (state.sectorAnalyzeTask && state.sectorAnalyzeTask.running) {
    state.sectorAnalyzePollTimer = setTimeout(pollSectorAnalyzeTask, pollInterval(1500, 'sectorAnalyze'));
  } else if (state.sectorAnalyzeTask && state.sectorAnalyzeTask.finishedAt) {
    state.sectorAnalyzePollTimer = null;
    const task = state.sectorAnalyzeTask;
    if (task.error) {
      notify(`板块分析失败：${task.error}`, 'error');
    } else {
      notify('板块 AI 参考分析已完成（评级与逻辑未改动）');
    }
    await loadOverview();
    renderPages();
  } else {
    state.sectorAnalyzePollTimer = null;
  }
}

async function startSectorAnalyze() {
  if (state.sectorAnalyzeTask && state.sectorAnalyzeTask.running) {
    notify('已有板块分析任务正在进行', 'error');
    return;
  }
  const hasQuote = (state.overview?.sectors || []).some((s) => {
    try {
      return Object.keys(JSON.parse(s.indicators || '{}')).length > 0;
    } catch {
      return false;
    }
  });
  if (!hasQuote) {
    notify('请先点击「采集板块行情」获取行情数据，再进行 AI 分析', 'error');
    return;
  }
  if (!confirm('将把已采集的板块行情发送给你配置的模型服务，生成「AI 参考分析」。参考结论不会改动你的评级与逻辑，确认开始？')) return;
  try {
    await api('/api/investment/analyze/sector', { method: 'POST', body: '{}' });
    state.sectorAnalyzeTask = { running: true, scope: 'sector', startedAt: new Date().toISOString(), log: '', finishedAt: null, error: null };
    updateCollectButtons();
    renderSectorPages();
    pollSectorAnalyzeTask();
  } catch (error) {
    notify(error.message, 'error');
  }
}

// 采纳板块 AI 参考建议：用户确认后写入评级/状态（逻辑与风险说明永不自动改动）
async function adoptSectorAnalysis(sectorId) {
  const record = state.overview?.sectors.find((s) => Number(s.id) === Number(sectorId));
  if (!record || !record.analysis_note) {
    notify('未找到该板块的 AI 参考分析', 'error');
    return;
  }
  // §2.3：过期结论不得作为当前建议采纳。过期时引导重新分析而非沿用陈旧判断。
  if (record.analysisFreshness?.stale) {
    notify(`该 AI 参考分析已过期（${record.analysisFreshness.days ?? '?'} 个交易日前生成），请先重新「AI 分析」再采纳`, 'error');
    return;
  }
  let note;
  try {
    note = JSON.parse(record.analysis_note);
  } catch {
    notify('分析数据无法解析', 'error');
    return;
  }
  const suggestedRating = Number(note.suggestedRating);
  const suggestedStatus = String(note.suggestedStatus || '').trim();
  if (!Number.isFinite(suggestedRating) || !suggestedStatus) {
    notify('参考建议缺少评级或状态，无法采纳', 'error');
    return;
  }
  if (!confirm(`将把「${record.name}」的评级调整为 ${suggestedRating.toFixed(1)}/5、状态调整为「${suggestedStatus}」。买入逻辑与风险说明不会改动，确认？`)) return;
  try {
    await api(`/api/investment/sectors/${sectorId}`, {
      method: 'PUT',
      body: JSON.stringify({ rating: suggestedRating, status: suggestedStatus, adopt_from_ai: true }),
    });
    await loadOverview();
    renderPages();
    notify(`已采纳 AI 参考建议：${record.name} 评级 ${suggestedRating.toFixed(1)}/5 · 状态「${suggestedStatus}」`);
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function loadOverview() {
  try {
    const [overview, reviewPayload] = await Promise.all([
      api('/api/investment/overview'),
      api(`/api/investment/daily-review?date=${currentReviewDate()}`),
    ]);
    state.overview = overview;
    state.review = reviewPayload.review;
    state.recentReviews = reviewPayload.recent || [];
    renderPages();
    updateTradingDayUI();
    $('#sync-state').textContent = `本地数据 · ${formatDateTime(state.overview.generatedAt)}`;
  } catch (error) {
    $('#sync-state').textContent = '数据连接失败';
    notify(error.message, 'error');
    $('#overview-content').innerHTML = renderEmpty('无法加载本地数据', `${error.message}。请确认通过 npm run serve 启动。`);
  }
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-start-review]')) { startReview().catch(() => {}); return; }
  const reviewNext = event.target.closest('[data-review-next]');
  if (reviewNext) { advanceReview(reviewNext.dataset.reviewNext).catch(() => {}); return; }
  const reviewTask = event.target.closest('[data-review-task]');
  if (reviewTask) {
    updateReviewTask(reviewTask.dataset.reviewTask, reviewTask.dataset.taskStatus).catch(() => {});
    return;
  }
  if (event.target.closest('[data-complete-review]')) { completeReview().catch(() => {}); return; }
  if (event.target.closest('[data-reopen-review]')) { reopenReview().catch(() => {}); return; }
  const pageButton = event.target.closest('[data-page-target]');
  if (pageButton) { switchPage(pageButton.dataset.pageTarget); return; }
  const logFilter = event.target.closest('[data-log-filter]');
  if (logFilter) { state.operationLogFilter = logFilter.dataset.logFilter; renderOperationLogs(); return; }
  if (event.target.closest('[data-refresh-logs]')) { loadOperationLogs(true); return; }
  const videoDateButton = event.target.closest('[data-video-date]');
  if (videoDateButton) {
    state.currentVideoDate = videoDateButton.dataset.videoDate;
    renderVideos();
    return;
  }
  const toHoldingButton = event.target.closest('[data-to-holding]');
  if (toHoldingButton) { openWatchToHolding(toHoldingButton.dataset.toHolding); return; }
  const addButton = event.target.closest('[data-open-form]');
  if (addButton) {
    if (!addButton.dataset.openForm && addButton.hasAttribute('data-generate-report')) return;
    openEditor(addButton.dataset.openForm);
    return;
  }
  const editButton = event.target.closest('[data-edit-resource]');
  if (editButton) {
    const record = findRecord(editButton.dataset.editResource, editButton.dataset.recordId);
    openEditor(configKeyForRecord(editButton.dataset.editResource, record), record);
    return;
  }
  const deleteButton = event.target.closest('[data-delete-resource]');
  if (deleteButton) { requestDelete(deleteButton.dataset.deleteResource, deleteButton.dataset.recordId); return; }
  if (event.target.closest('[data-edit-account]')) { openEditor('account', state.overview.account); return; }
  if (event.target.closest('[data-edit-market]')) { openEditor('market', state.overview.market); return; }
  const goldButton = event.target.closest('[data-refresh-gold]');
  if (goldButton) { loadGoldMarket(true); return; }
  const tasksButton = event.target.closest('[data-refresh-tasks]');
  if (tasksButton) { loadTasks(true); return; }
  const runTaskButton = event.target.closest('[data-run-task]');
  if (runTaskButton) { runTaskNow(runTaskButton.dataset.runTask); return; }
  const fundamentalsButton = event.target.closest('[data-refresh-fundamentals]');
  if (fundamentalsButton) { refreshFundamentalsPanel(); return; }
  const quotesButton = event.target.closest('[data-refresh-quotes]');
  if (quotesButton) { refreshQuotesPanel(); return; }
  const collectButton = event.target.closest('[data-collect]');
  if (collectButton) { startCollect(collectButton.dataset.collect); return; }
  const marketAnalyzeButton = event.target.closest('[data-analyze-market]');
  if (marketAnalyzeButton) { startMarketAnalyze(); return; }
  const sectorAnalyzeButton = event.target.closest('[data-analyze-sector]');
  if (sectorAnalyzeButton) { startSectorAnalyze(); return; }
  const adoptButton = event.target.closest('[data-adopt-sector-analysis]');
  if (adoptButton) { adoptSectorAnalysis(adoptButton.dataset.adoptSectorAnalysis).catch(() => {}); return; }
  const portfolioTabButton = event.target.closest('[data-portfolio-tab]');
  if (portfolioTabButton) { state.portfolioTab = portfolioTabButton.dataset.portfolioTab; renderPages(); return; }
  const filterButton = event.target.closest('[data-holding-filter]');
  if (filterButton) { state.holdingFilter = filterButton.dataset.holdingFilter; renderPages(); return; }
  const generateButton = event.target.closest('[data-generate-report]');
  if (generateButton) { generateReport(generateButton); return; }
  const analyzeButton = event.target.closest('[data-analyze-videos]');
  if (analyzeButton) { startAnalyzeVideos(); }
});

document.addEventListener('change', event => {
  if (event.target.matches('[data-review-note]')) {
    saveReviewTaskNote(event.target.dataset.reviewNote, event.target.value).catch(() => {});
  }
});

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => $('#record-dialog').close()));
$$('[data-close-confirm]').forEach(button => button.addEventListener('click', () => $('#confirm-dialog').close()));
$('#record-form').addEventListener('submit', saveEditor);
$('#confirm-delete').addEventListener('click', confirmDelete);
$('#refresh-button').addEventListener('click', async () => {
  if (state.currentPage === 'macro') await loadGoldMarket(true);
  else if (state.currentPage === 'operations') await loadOperationLogs(true);
  else await loadOverview();
  if (state.currentPage === 'holdings') renderFundamentals();
  if (state.currentPage === 'videos') await loadVideoLibrary(true);
  if (!['macro', 'operations'].includes(state.currentPage)) notify('已刷新本地数据');
});
$('#record-dialog').addEventListener('click', event => { if (event.target === $('#record-dialog')) $('#record-dialog').close(); });
$('#confirm-dialog').addEventListener('click', event => { if (event.target === $('#confirm-dialog')) $('#confirm-dialog').close(); });

let initialPage = location.hash.slice(1);
// 兼容旧书签：关注列表已并入「持仓与关注」
if (initialPage === 'watchlist') {
  history.replaceState(null, '', '#holdings');
  initialPage = 'holdings';
}
if (pageLabels[initialPage]) switchPage(initialPage);
// 启动时检查是否有未完成的采集/分析任务（如定时任务启动的），恢复轮询
api('/api/investment/collect').then(task => {
  state.collectTask = task;
  updateCollectButtons();
  if (task && task.running) pollCollectTask();
}).catch(() => {});
api('/api/investment/analyze').then(task => {
  state.marketAnalyzeTask = task;
  renderMarketPage();
  if (task && task.running) pollMarketAnalyzeTask();
}).catch(() => {});
api('/api/investment/analyze/sector').then(task => {
  state.sectorAnalyzeTask = task;
  renderSectorPages();
  if (task && task.running) pollSectorAnalyzeTask();
}).catch(() => {});
loadOverview();
