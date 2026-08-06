/*
 * A 股交易日历（沪深北交易所）。
 *
 * 交易日 = 周一至周五，且不在交易所公告的节假日休市区间内。
 * 周末（含调休补班日）A 股一律休市，因此只需排除「落在工作日」的休市日。
 *
 * 数据来源：沪深北交易所《2026 年部分节假日休市安排》
 * （2025-12-22 发布；元旦/春节/清明/劳动节/端午/中秋/国庆）。
 * ⚠️ 每年年初交易所发布新安排后，需要把当年落在工作日的休市日补充进 HOLIDAYS_2027。
 *
 * 供看板页面「今日决策 / AI 日报」、定时任务（serve.cjs）判断是否交易日。
 */
'use strict';

/** 2026 年落在工作日、需要额外排除的休市日（周末已由 isTradingDay 自动排除）。 */
const HOLIDAYS_2026 = new Set([
  // 元旦：1/1(四)-1/3(六) 休市；1/4(日) 周末休市
  '2026-01-01', '2026-01-02',
  // 春节：2/15(日)-2/23(一) 休市
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  // 清明节：4/4(六)-4/6(一) 休市
  '2026-04-06',
  // 劳动节：5/1(五)-5/5(二) 休市
  '2026-05-01', '2026-05-04', '2026-05-05',
  // 端午节：6/19(五)-6/21(日) 休市
  '2026-06-19',
  // 中秋节：9/25(五)-9/27(日) 休市
  '2026-09-25',
  // 国庆节：10/1(四)-10/7(三) 休市
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
]);

/** 交易日历覆盖的最新年份。超出此年份的日期，节假日数据缺失，isTradingDay 只能按「普通工作日」判断，可能漏掉休市日。 */
const CALENDAR_COVERAGE_YEAR = 2026;
let coverageWarned = false;

/** 本地时区 YYYY-MM-DD（依赖进程级 process.env.TZ='Asia/Shanghai'，见 serve.cjs）。 */
function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 是否为 A 股交易日（默认今天）。 */
function isTradingDay(date = new Date()) {
  const key = toDateKey(date);
  if (!key) return false;
  const year = Number(key.slice(0, 4));
  // 年份超出休市数据覆盖范围时告警一次：此时只能按周末判断，春节/国庆等休市日会被误判为交易日，
  // 定时任务会在休市日空跑。需补充当年交易所休市安排后更新 CALENDAR_COVERAGE_YEAR。
  if (year > CALENDAR_COVERAGE_YEAR && !coverageWarned) {
    coverageWarned = true;
    console.warn(`[trading-calendar] ⚠ 当前年份 ${year} 超出休市数据覆盖范围（截至 ${CALENDAR_COVERAGE_YEAR}），节假日休市日可能被误判为交易日，请补充当年交易所休市安排。`);
  }
  const day = new Date(`${key}T00:00:00`).getDay(); // 本地时区
  if (day === 0 || day === 6) return false;
  if (year === 2026) return !HOLIDAYS_2026.has(key);
  return true; // 覆盖范围外的工作日按交易日处理（已告警）
}

/** 重置告警标志（测试用）。 */
function _resetCoverageWarned() { coverageWarned = false; }

/** 从指定日期起的下一个交易日（含当天，若当天是交易日则返回当天）。 */
function nextTradingDay(date = new Date()) {
  const cursor = new Date(date);
  for (let i = 0; i < 366; i += 1) {
    if (isTradingDay(cursor)) return cursor;
    cursor.setDate(cursor.getDate() + 1);
  }
  return cursor;
}

/** 下个交易日的 YYYY-MM-DD 文本；带 reference 时用于提示「下一交易日 8月3日」。 */
function nextTradingDayKey(date = new Date()) {
  return toDateKey(nextTradingDay(date));
}

module.exports = {
  isTradingDay,
  nextTradingDay,
  nextTradingDayKey,
  toDateKey,
  HOLIDAYS_2026,
  CALENDAR_COVERAGE_YEAR,
  _resetCoverageWarned,
};
