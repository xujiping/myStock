/*
 * 看板服务内置定时任务调度器。
 *
 * 服务运行期间（serve.cjs 存活）按计划自动触发任务，不再依赖 launchd 等外部
 * 定时器。任务状态通过 GET /api/investment/tasks 暴露给看板「定时任务」页，
 * 支持页面手动「立即运行」。
 *
 * 任务类型：
 *   - intervalMs：固定间隔，服务启动即先跑一次
 *   - { hour, minute, weekdays, excludedDates? }：每日/工作日定点（如工作日 16:10 采集、
 *     每天 23:30 备份）；excludedDates 为 YYYY-MM-DD 数组，用于排除法定节假日（A 股休市日）。
 *     服务启动时若已过当日计划时刻则自动补跑（catch-up）
 *
 * 纯调度逻辑，不依赖具体业务；任务执行函数由 serve.cjs 注入。
 */

/** 失败任务的当日最大重试次数（每次间隔 30 分钟，见 isDue）。防止瞬时故障导致整天数据空缺。 */
const MAX_RETRIES = 2;

class TaskScheduler {
  /**
   * @param {object} options
   * @param {Array<object>} options.tasks  任务定义（见下）
   * @param {number} [options.tickMs=60000] 调度检查间隔
   * @param {() => Date} [options.now]      时间源（测试用）
   */
  constructor({ tasks = [], tickMs = 60000, now = () => new Date() }) {
    this.tickMs = tickMs;
    this.now = now;
    this.timer = null;
    this.tasks = tasks.map((t) => ({
      ...t,
      running: false,
      lastRunAt: t.lastRunAt || null,
      lastFinishedAt: t.lastFinishedAt || null,
      lastStatus: t.lastStatus || '',
      lastSummary: t.lastSummary || '',
      lastDurationMs: t.lastDurationMs || 0,
      nextRunAt: null,
    }));
    this.recomputeNextRunAt();
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 计算每个任务的下一次计划运行时间（ISO 字符串）。 */
  recomputeNextRunAt() {
    const now = this.now();
    for (const t of this.tasks) {
      t.nextRunAt = t.intervalMs
        ? new Date((t.lastRunAt ? new Date(t.lastRunAt).getTime() : now.getTime()) + t.intervalMs).toISOString()
        : nextDailyAt(t, now).toISOString();
    }
  }

  /** 判断任务此刻是否到期。 */
  isDue(t, now) {
    if (t.running) return false;
    if (t.intervalMs) {
      if (!t.lastRunAt) return true; // 服务启动即先跑一次
      return now.getTime() - new Date(t.lastRunAt).getTime() >= t.intervalMs;
    }
    const plan = todayPlanAt(t, now);
    if (!plan || now < plan) return false; // 今天不是计划日，或还没到点
    if (!t.lastRunAt) return true; // 从未运行：启动补跑
    const last = new Date(t.lastRunAt);
    const lastPlan = todayPlanAt(t, last);
    const alreadyRanToday = lastPlan && last.getTime() >= lastPlan.getTime();
    if (!alreadyRanToday) return true; // 今天计划点已过但今天还没跑过（崩溃恢复补采）
    // 今天已跑过：仅当上次失败且未超重试上限时，按重试间隔到期
    if (t.lastStatus === 'failed' && (t.retryCount || 0) < MAX_RETRIES) {
      const retryDelayMs = 30 * 60 * 1000; // 失败后 30 分钟重试一次
      return now.getTime() - last.getTime() >= retryDelayMs;
    }
    return false;
  }

  tick() {
    const now = this.now();
    for (const t of this.tasks) {
      if (this.isDue(t, now)) {
        // 不静默吞异常：runTask 内部已有 try/catch，这里兜底记录意外失败（如 recomputeNextRunAt 抛错），
        // 否则调度循环会静默失效、nextRunAt 不更新，当天任务永远不再触发。
        this.runTask(t).catch((err) => {
          console.error(`[scheduler] 任务 ${t.key} 意外失败：${err && err.message ? err.message : err}`);
        });
      }
    }
  }

  /** 立即运行指定任务（页面「立即运行」）。 */
  async runNow(key) {
    const t = this.tasks.find((item) => item.key === key);
    if (!t) return { ok: false, error: `未知任务：${key}` };
    if (t.running) return { ok: false, error: `${t.title} 正在运行，请稍候` };
    await this.runTask(t);
    return { ok: true, summary: t.lastSummary, status: t.lastStatus };
  }

  async runTask(t) {
    t.running = true;
    t.lastRunAt = this.now().toISOString();
    t.lastStatus = 'running';
    t.lastSummary = '任务执行中…';
    const startedAt = Date.now();
    try {
      const result = await t.run(t);
      t.lastStatus = result && result.ok ? 'success' : 'failed';
      t.lastSummary = (result && result.summary) || (result && result.error) || (result && result.ok ? '完成' : '失败');
    } catch (error) {
      t.lastStatus = 'failed';
      t.lastSummary = error.message || '执行异常';
    }
    t.lastDurationMs = Date.now() - startedAt;
    t.lastFinishedAt = this.now().toISOString();
    t.running = false;
    // 成功则重置重试计数；失败则递增，配合 isDue 的重试间隔实现自动重试
    if (t.lastStatus === 'success') {
      t.retryCount = 0;
    } else {
      t.retryCount = (t.retryCount || 0) + 1;
      if (t.retryCount <= MAX_RETRIES) {
        console.warn(`[scheduler] 任务 ${t.key} 失败（第 ${t.retryCount}/${MAX_RETRIES} 次），将在 30 分钟后重试：${t.lastSummary}`);
      } else {
        console.warn(`[scheduler] 任务 ${t.key} 已达最大重试次数 ${MAX_RETRIES}，当日不再重试，等下一计划点。`);
      }
    }
    this.recomputeNextRunAt();
  }

  /** 页面展示用快照；syncStatus 可选，用于把外部任务（如采集子进程）状态合并进来。 */
  listTasks() {
    return this.tasks.map((t) => {
      const snapshot = {
        key: t.key,
        title: t.title,
        description: t.description,
        scheduleText: t.scheduleText,
        operationKey: t.operationKey || '',
        running: t.running,
        lastRunAt: t.lastRunAt,
        lastFinishedAt: t.lastFinishedAt,
        lastStatus: t.lastStatus,
        lastSummary: t.lastSummary,
        lastDurationMs: t.lastDurationMs,
        nextRunAt: t.nextRunAt,
        retryCount: t.retryCount || 0,
      };
      if (typeof t.syncStatus === 'function') Object.assign(snapshot, t.syncStatus(t));
      return snapshot;
    });
  }
}

/** 本地时区 YYYY-MM-DD（排除节假日用）。 */
function dateKey(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 今天的计划时刻；若今天不在 weekdays（未配置则不限）内、或落在 excludedDates
 * （YYYY-MM-DD 节假日数组）内则返回 null。
 */
function todayPlanAt(t, date) {
  const d = new Date(date);
  const weekday = d.getDay(); // 0=周日 … 6=周六
  if (Array.isArray(t.weekdays) && !t.weekdays.includes(weekday)) return null;
  if (Array.isArray(t.excludedDates) && t.excludedDates.includes(dateKey(d))) return null;
  const plan = new Date(d);
  plan.setHours(t.hour, t.minute, 0, 0);
  return plan;
}

/**
 * 从 now 起下一个符合计划的时刻（含今天未到点的情况）。
 * 循环 32 天足够跨越春节等长假（最长 9 天休市）与周末组合。
 */
function nextDailyAt(t, now) {
  const candidate = new Date(now);
  for (let i = 0; i < 32; i += 1) {
    const plan = todayPlanAt(t, candidate);
    if (plan && plan.getTime() > now.getTime()) return plan;
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  return new Date(now);
}

module.exports = { TaskScheduler, todayPlanAt, nextDailyAt };
