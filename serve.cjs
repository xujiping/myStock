#!/usr/bin/env node
/*
 * AI 辅助投资系统本地服务。
 *
 * - 托管投资工作台与旧视频看板
 * - 提供 SQLite 持久化的投资业务 API
 * - 原视频只读，仅用于复核观点
 *
 * 用法：node serve.cjs [--port 4173] [--no-open]
 */
// 进程级锁定东八区：定时任务（16:10 采集 / 15:10 行情）与交易日判定都按 Asia/Shanghai，
// 避免部署到非东八区时调度偏移整天。须在所有日期计算前设置。
process.env.TZ = 'Asia/Shanghai';
require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { InvestmentStore, localDate } = require('./investment-store.cjs');
const { refreshGoldMarket } = require('./gold-market.cjs');
const {
  refreshFundamentals,
  readFundamentalsRows,
} = require('./stock-fundamentals.cjs');
const { TaskScheduler } = require('./scripts/task-scheduler.cjs');
const { isTradingDay, nextTradingDayKey, HOLIDAYS_2026 } = require('./scripts/trading-calendar.cjs');
const { collectQuotes } = require('./scripts/collect-quotes.cjs');
const {
  buildOverview,
  createDailyAnalysis,
  getVideoResearchLibrary,
  summarizeVideoEvidence,
} = require('./investment-analysis.cjs');

const ROOT = __dirname;
const REPORT_DIR = path.join(ROOT, 'reports');
const VIDEO_DIR = path.join(ROOT, 'videos');
const DASHBOARD_FILE = path.join(ROOT, 'investment-dashboard.html');
const LEGACY_DASHBOARD_FILE = path.join(REPORT_DIR, 'A股视频看板.html');

// 视频分析任务进度（单实例内存状态，重启后清空）
const analyzeTask = { running: false, startedAt: null, log: '', error: null, finishedAt: null, operationId: null, operationFinished: false };

// 数据采集任务进度（宏观 / 市场 / 板块 / 全部）。同一时间只允许一个采集任务。
const COLLECT_SCRIPTS = {
  macro: 'scripts/collect-macro.cjs',
  market: 'scripts/collect-market.cjs',
  sector: 'scripts/collect-sector.cjs',
  all: 'scripts/collect-all.cjs',
};
const collectTask = {
  running: false,
  scope: null,           // macro / market / sector / all
  startedAt: null,
  finishedAt: null,
  log: '',
  error: null,
  exitCode: null,
  operationId: null,
  operationFinished: false,
};

// 市场环境 AI 分析任务进度。与采集互斥：先采集原始行情，再基于同一份数据做分析。
const ANALYZE_SCRIPTS = {
  market: 'scripts/analyze-market.cjs',
  sector: 'scripts/analyze-sector.cjs',
};
const marketAnalyzeTask = {
  running: false,
  scope: null,           // market
  startedAt: null,
  finishedAt: null,
  log: '',
  error: null,
  exitCode: null,
  operationId: null,
  operationFinished: false,
};
// 板块 AI 参考分析任务（独立于市场分析，写入 sector 表，不覆盖人工评级）
const sectorAnalyzeTask = {
  running: false,
  scope: null,           // sector
  startedAt: null,
  finishedAt: null,
  log: '',
  error: null,
  exitCode: null,
  operationId: null,
  operationFinished: false,
};

function finishBackgroundOperation(store, task, payload) {
  if (!task.operationId || task.operationFinished) return;
  task.operationFinished = true;
  try {
    store.finishOperation(task.operationId, payload);
  } catch (error) {
    console.error(`运行日志写入失败：${error.message}`);
  }
}

async function runLoggedOperation(store, logPayload, action, summarize) {
  const operation = store.startOperation(logPayload);
  try {
    const result = await action();
    store.finishOperation(operation.id, {
      status: 'success',
      summary: typeof summarize === 'function' ? summarize(result) : '任务已完成',
      metadata: logPayload.metadata,
    });
    return result;
  } catch (error) {
    store.finishOperation(operation.id, {
      status: 'failed',
      summary: error.message || '任务执行失败',
      details: error.stack || error.message || String(error),
      metadata: logPayload.metadata,
    });
    throw error;
  }
}

function startCollectTask(store, scope) {
  const script = COLLECT_SCRIPTS[scope];
  if (!script) throw Object.assign(new Error('未知的采集范围'), { statusCode: 400 });
  if (collectTask.running) {
    throw Object.assign(new Error(`已有采集任务（${collectTask.scope}）正在进行，请等待完成`), { statusCode: 409 });
  }
  if (marketAnalyzeTask.running) {
    throw Object.assign(new Error('市场环境 AI 分析正在进行，请等待分析完成后再采集新数据'), { statusCode: 409 });
  }
  collectTask.running = true;
  collectTask.scope = scope;
  collectTask.startedAt = new Date().toISOString();
  collectTask.finishedAt = null;
  collectTask.error = null;
  collectTask.exitCode = null;
  collectTask.log = '';
  collectTask.operationFinished = false;
  const labels = { macro: '宏观变量采集', market: 'A 股市场采集', sector: '板块行情采集', all: '全部行情采集' };
  const operation = store.startOperation({
    category: 'collection',
    operationKey: `collect-${scope}`,
    title: labels[scope],
    summary: '正在读取外部行情并写入本地数据库',
    metadata: { scope },
  });
  collectTask.operationId = operation.id;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
    cwd: ROOT,
    env: { ...process.env, KAI_OPERATION_PARENT_ID: String(operation.id) },
  });
  const pushLog = (chunk) => {
    collectTask.log += chunk.toString();
    if (collectTask.log.length > 20000) collectTask.log = collectTask.log.slice(-20000);
  };
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('error', (error) => {
    collectTask.running = false;
    collectTask.finishedAt = new Date().toISOString();
    collectTask.error = `无法启动采集进程：${error.message}`;
    finishBackgroundOperation(store, collectTask, {
      status: 'failed',
      summary: collectTask.error,
      details: collectTask.log || error.stack || error.message,
      metadata: { scope },
    });
  });
  child.on('exit', (code) => {
    collectTask.running = false;
    collectTask.finishedAt = new Date().toISOString();
    collectTask.exitCode = code;
    if (code !== 0) collectTask.error = `采集进程退出码 ${code}`;
    finishBackgroundOperation(store, collectTask, {
      status: code === 0 ? 'success' : 'failed',
      summary: code === 0 ? `${labels[scope]}完成` : collectTask.error,
      details: collectTask.log,
      metadata: { scope, exitCode: code },
    });
  });
}

function startAnalyzeTask(store, scope) {
  const script = ANALYZE_SCRIPTS[scope];
  if (!script) throw Object.assign(new Error('未知的分析范围'), { statusCode: 400 });
  if (marketAnalyzeTask.running) {
    throw Object.assign(new Error(`已有分析任务（${marketAnalyzeTask.scope}）正在进行，请等待完成`), { statusCode: 409 });
  }
  if (collectTask.running) {
    throw Object.assign(new Error('行情采集正在进行，请等待采集完成后再分析（先采后析，保证基于同一份数据）'), { statusCode: 409 });
  }
  marketAnalyzeTask.running = true;
  marketAnalyzeTask.scope = scope;
  marketAnalyzeTask.startedAt = new Date().toISOString();
  marketAnalyzeTask.finishedAt = null;
  marketAnalyzeTask.error = null;
  marketAnalyzeTask.exitCode = null;
  marketAnalyzeTask.log = '';
  marketAnalyzeTask.operationFinished = false;
  const labels = { market: '市场环境 AI 分析' };
  const operation = store.startOperation({
    category: 'analysis',
    operationKey: `analyze-${scope}`,
    title: labels[scope],
    summary: '正在基于已采集行情调用模型生成风险与机会判断',
    metadata: { scope },
  });
  marketAnalyzeTask.operationId = operation.id;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
    cwd: ROOT,
    env: { ...process.env, KAI_OPERATION_PARENT_ID: String(operation.id) },
  });
  const pushLog = (chunk) => {
    marketAnalyzeTask.log += chunk.toString();
    if (marketAnalyzeTask.log.length > 20000) marketAnalyzeTask.log = marketAnalyzeTask.log.slice(-20000);
  };
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('error', (error) => {
    marketAnalyzeTask.running = false;
    marketAnalyzeTask.finishedAt = new Date().toISOString();
    marketAnalyzeTask.error = `无法启动分析进程：${error.message}`;
    finishBackgroundOperation(store, marketAnalyzeTask, {
      status: 'failed',
      summary: marketAnalyzeTask.error,
      details: marketAnalyzeTask.log || error.stack || error.message,
      metadata: { scope },
    });
  });
  child.on('exit', (code) => {
    marketAnalyzeTask.running = false;
    marketAnalyzeTask.finishedAt = new Date().toISOString();
    marketAnalyzeTask.exitCode = code;
    if (code !== 0) marketAnalyzeTask.error = `分析进程退出码 ${code}`;
    finishBackgroundOperation(store, marketAnalyzeTask, {
      status: code === 0 ? 'success' : 'failed',
      summary: code === 0 ? `${labels[scope]}完成` : marketAnalyzeTask.error,
      details: marketAnalyzeTask.log,
      metadata: { scope, exitCode: code },
    });
  });
}

function startSectorAnalyzeTask(store, scope) {
  const script = ANALYZE_SCRIPTS[scope];
  if (!script) throw Object.assign(new Error('未知的分析范围'), { statusCode: 400 });
  if (sectorAnalyzeTask.running) {
    throw Object.assign(new Error(`已有板块分析任务正在进行，请等待完成`), { statusCode: 409 });
  }
  if (collectTask.running) {
    throw Object.assign(new Error('行情采集正在进行，请等待采集完成后再分析（先采后析）'), { statusCode: 409 });
  }
  sectorAnalyzeTask.running = true;
  sectorAnalyzeTask.scope = scope;
  sectorAnalyzeTask.startedAt = new Date().toISOString();
  sectorAnalyzeTask.finishedAt = null;
  sectorAnalyzeTask.error = null;
  sectorAnalyzeTask.exitCode = null;
  sectorAnalyzeTask.log = '';
  sectorAnalyzeTask.operationFinished = false;
  const labels = { sector: '板块 AI 参考分析' };
  const operation = store.startOperation({
    category: 'analysis',
    operationKey: `analyze-${scope}`,
    title: labels[scope],
    summary: '正在基于已采集板块行情调用模型生成参考分析',
    metadata: { scope },
  });
  sectorAnalyzeTask.operationId = operation.id;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
    cwd: ROOT,
    env: { ...process.env, KAI_OPERATION_PARENT_ID: String(operation.id) },
  });
  const pushLog = (chunk) => {
    sectorAnalyzeTask.log += chunk.toString();
    if (sectorAnalyzeTask.log.length > 20000) sectorAnalyzeTask.log = sectorAnalyzeTask.log.slice(-20000);
  };
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('error', (error) => {
    sectorAnalyzeTask.running = false;
    sectorAnalyzeTask.finishedAt = new Date().toISOString();
    sectorAnalyzeTask.error = `无法启动分析进程：${error.message}`;
    finishBackgroundOperation(store, sectorAnalyzeTask, {
      status: 'failed',
      summary: sectorAnalyzeTask.error,
      details: sectorAnalyzeTask.log || error.stack || error.message,
      metadata: { scope },
    });
  });
  child.on('exit', (code) => {
    sectorAnalyzeTask.running = false;
    sectorAnalyzeTask.finishedAt = new Date().toISOString();
    sectorAnalyzeTask.exitCode = code;
    if (code !== 0) sectorAnalyzeTask.error = `分析进程退出码 ${code}`;
    finishBackgroundOperation(store, sectorAnalyzeTask, {
      status: code === 0 ? 'success' : 'failed',
      summary: code === 0 ? `${labels[scope]}完成` : sectorAnalyzeTask.error,
      details: sectorAnalyzeTask.log,
      metadata: { scope, exitCode: code },
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
};

function log(message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${message}`);
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'",
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, securityHeaders('text/plain; charset=utf-8'));
  res.end(text);
}

function safeResolve(base, relativePath) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativePath);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) return null;
  return resolved;
}

function sendFile(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const baseHeaders = {
    ...securityHeaders(contentType),
    'Accept-Ranges': 'bytes',
    'Cache-Control': contentType.startsWith('video/') ? 'private, max-age=3600' : 'no-cache',
  };
  const range = req.headers.range;
  if (range && contentType.startsWith('video/')) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(filePath).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error('请求内容不能超过 1MB'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求内容不是合法 JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function parseFilters(searchParams) {
  return {
    list_type: searchParams.get('list_type') || '',
    record_type: searchParams.get('record_type') || '',
  };
}

function latestOperationLog(store, operationKey) {
  return store.db.prepare(`
    SELECT * FROM kai_invest_operation_log
    WHERE operation_key = ?
    ORDER BY started_at DESC, id DESC LIMIT 1
  `).get(operationKey) || null;
}

/**
 * 写操作（POST/PUT/DELETE）的本地鉴权：校验 Host/Origin 头指向本机，
 * 拦截 DNS rebinding 与跨站伪造请求。服务只绑 127.0.0.1，但浏览器里
 * 被打开的恶意页面仍能对本机端口发起 fetch，需在写路由把关。
 * @returns {string|null}  拒绝原因；null 表示通过
 */
function checkLocalOrigin(req) {
  const host = String(req.headers.host || '');
  // Host 头的 hostname 部分必须是本机回环（端口可变，4173-4183）
  const hostName = host.split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(hostName)) {
    return `非法 Host：${host}`;
  }
  // 若带 Origin 头（跨站请求会带），其 hostname 也必须是本机
  const origin = String(req.headers.origin || '');
  if (origin && origin !== 'null') {
    try {
      const originHost = new URL(origin).hostname;
      if (!['127.0.0.1', 'localhost'].includes(originHost)) {
        return `非法 Origin：${origin}`;
      }
    } catch {
      return `非法 Origin：${origin}`;
    }
  }
  return null;
}

/**
 * 服务启动时把遗留的 running 任务标记为失败（服务重启导致中断）。
 * 上一轮进程若在分析/采集中途被重启，操作日志会永远停留在 running，
 * 前端也无法感知中断。启动时统一收尾，让日志与前端状态一致。
 */
function markInterruptedOperations(store) {
  const rows = store.db.prepare(`
    SELECT id, operation_key, title FROM kai_invest_operation_log
    WHERE status = 'running'
    ORDER BY started_at ASC
  `).all();
  for (const row of rows) {
    try {
      store.finishOperation(row.id, {
        status: 'failed',
        summary: `${row.title || '任务'}因服务重启而中断（未完成，可重新发起）`,
        details: '服务在任务运行期间被重启，进程状态丢失，任务未完成。请重新点击对应按钮发起。',
        metadata: { interruptedByRestart: true },
      });
    } catch (error) {
      console.error(`标记中断任务失败（operation ${row.id}）：${error.message}`);
    }
  }
  if (rows.length) {
    log(`已将 ${rows.length} 个因服务重启遗留的运行中任务标记为中断`);
  }
}

/** 从历史运行日志恢复任务的上次状态（服务重启后页面仍能看到）。 */
function restoreTaskStatus(store, operationKey) {
  const op = latestOperationLog(store, operationKey);
  if (!op) return {};
  return {
    lastRunAt: op.started_at,
    lastFinishedAt: op.finished_at || op.started_at,
    lastStatus: op.status,
    lastSummary: op.summary,
  };
}

/** 看板服务内置定时任务：每日数据采集 / 数据库备份。 */
function createTaskScheduler(store) {
  const tasks = [
    {
      key: 'daily-collect',
      title: '每日数据采集',
      description: '采集宏观变量、A 股市场环境与板块行情。',
      scheduleText: '交易日 16:10',
      operationKey: 'collect-all',
      hour: 16,
      minute: 10,
      weekdays: [1, 2, 3, 4, 5],
      excludedDates: HOLIDAYS_2026,
      run: () => {
        try {
          startCollectTask(store, 'all');
          return { ok: true, summary: '已启动每日数据采集（宏观+市场+板块）' };
        } catch (error) {
          return { ok: false, summary: error.message };
        }
      },
      syncStatus: () => {
        if (!collectTask.startedAt) return {};
        const snapshot = { lastRunAt: collectTask.startedAt, running: collectTask.running };
        if (collectTask.finishedAt) {
          snapshot.lastFinishedAt = collectTask.finishedAt;
          snapshot.lastStatus = collectTask.exitCode === 0 ? 'success' : 'failed';
          snapshot.lastSummary = collectTask.error || '全部行情采集完成';
        } else {
          snapshot.lastStatus = 'running';
          snapshot.lastSummary = '正在采集（宏观→市场→板块）…';
        }
        return snapshot;
      },
      ...restoreTaskStatus(store, 'collect-all'),
    },
    {
      key: 'quotes-refresh',
      title: '每日行情刷新',
      description: '刷新持仓与关注股票的最新价格与当日涨跌幅（收盘后）。',
      scheduleText: '交易日 15:10',
      operationKey: 'refresh-quotes',
      hour: 15,
      minute: 10,
      weekdays: [1, 2, 3, 4, 5],
      excludedDates: HOLIDAYS_2026,
      run: async () => {
        const codes = store.list('portfolio')
          .filter((item) => {
            const code = String(item.stock_code || '').trim();
            if (!/^\d{6}$/.test(code)) return false;
            if (item.list_type === 'holding') return item.quantity > 0 && !item.closed_at;
            return item.list_type === 'watch';
          })
          .map((item) => String(item.stock_code).trim());
        if (!codes.length) return { ok: true, summary: '没有需要刷新的持仓或关注' };
        const result = await collectQuotes(store, codes);
        // 三态判定：有成功即 ok（个别停牌/退市不应让整个任务标 failed，掩盖「绝大多数已更新」）
        const ok = result.results.length > 0;
        let summary;
        if (!result.errors.length) summary = `已更新全部 ${result.results.length} 只行情`;
        else if (ok) summary = `已更新 ${result.results.length} 只行情，${result.errors.length} 只未取得数据（停牌/退市等）`;
        else summary = `全部 ${result.errors.length} 只均未取得数据`;
        return { ok, summary };
      },
      ...restoreTaskStatus(store, 'refresh-quotes'),
    },
    {
      key: 'daily-backup',
      title: '数据库备份',
      description: 'WAL checkpoint 后热备份 data/investment.sqlite，自动保留最近 30 份。',
      scheduleText: '每天 23:30',
      operationKey: 'backup-database',
      hour: 23,
      minute: 30,
      run: async () => {
        const operation = store.startOperation({
          category: 'system',
          operationKey: 'backup-database',
          title: '投资数据库备份（定时）',
          summary: '正在备份数据库',
          triggerSource: 'scheduler',
        });
        const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/backup-investment.cjs'], {
          cwd: ROOT,
          env: { ...process.env, KAI_OPERATION_PARENT_ID: String(operation.id) },
        });
        const code = await new Promise((resolve) => {
          child.on('close', resolve);
          child.on('error', () => resolve(1));
        });
        const summary = code === 0 ? '数据库备份完成' : `备份失败（退出码 ${code}）`;
        store.finishOperation(operation.id, { status: code === 0 ? 'success' : 'failed', summary });
        return { ok: code === 0, summary };
      },
      ...restoreTaskStatus(store, 'backup-database'),
    },
  ];
  return new TaskScheduler({ tasks, tickMs: 30000 });
}

function createAppServer(options = {}) {
  const store = options.store || new InvestmentStore(options.databasePath);
  if (!options.skipInterruptRecovery) markInterruptedOperations(store);
  const scheduler = createTaskScheduler(store);
  scheduler.start();
  const server = http.createServer(async (req, res) => {
    let requestUrl;
    let pathname = req.url || '/';

    try {
      requestUrl = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(requestUrl.pathname);
      // 写操作（POST/PUT/DELETE）必须来自本机，拦截 DNS rebinding 与跨站请求
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        const denyReason = checkLocalOrigin(req);
        if (denyReason) {
          sendJson(res, 403, { error: `请求被拒绝：${denyReason}（本服务仅限本机访问）` });
          return;
        }
      }
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          service: 'ai-investment-dashboard',
          database: path.basename(store.databasePath),
          videoEvidence: summarizeVideoEvidence(0).totalVideos,
        });
        return;
      }

      if (pathname === '/api/investment/overview' && req.method === 'GET') {
        sendJson(res, 200, buildOverview(store));
        return;
      }

      if (pathname === '/api/investment/tasks' && req.method === 'GET') {
        sendJson(res, 200, { tasks: scheduler.listTasks() });
        return;
      }

      const runTaskMatch = pathname.match(/^\/api\/investment\/tasks\/([\w-]+)\/run$/);
      if (runTaskMatch && req.method === 'POST') {
        const result = await scheduler.runNow(runTaskMatch[1]);
        sendJson(res, result.ok ? 200 : 409, result);
        return;
      }

      if (pathname === '/api/investment/operation-logs' && req.method === 'GET') {
        const items = store.listOperationLogs({
          category: requestUrl.searchParams.get('category') || '',
          status: requestUrl.searchParams.get('status') || '',
          limit: requestUrl.searchParams.get('limit') || 100,
        });
        sendJson(res, 200, {
          items,
          summary: {
            total: items.length,
            running: items.filter((item) => item.status === 'running').length,
            success: items.filter((item) => item.status === 'success').length,
            failed: items.filter((item) => item.status === 'failed').length,
          },
        });
        return;
      }

      if (pathname === '/api/investment/daily-review' && req.method === 'GET') {
        sendJson(res, 200, {
          review: store.getDailyReview(requestUrl.searchParams.get('date') || undefined),
          recent: store.listDailyReviews(7),
        });
        return;
      }

      if (pathname === '/api/investment/daily-review' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const reviewDate = String(body.review_date || localDate());
        if (!isTradingDay(new Date(`${reviewDate}T12:00:00`))) {
          sendJson(res, 400, { error: `今天不是交易日，无需复盘；下一交易日为 ${nextTradingDayKey()}。` });
          return;
        }
        sendJson(res, 200, store.saveDailyReview(body));
        return;
      }

      if (pathname === '/api/investment/video-evidence' && req.method === 'GET') {
        sendJson(res, 200, getVideoResearchLibrary());
        return;
      }

      if (pathname === '/api/investment/daily-analysis' && req.method === 'POST') {
        if (!isTradingDay()) {
          sendJson(res, 400, { error: `今天不是交易日，不生成日报；下一交易日为 ${nextTradingDayKey()}。` });
          return;
        }
        const body = await readJsonBody(req);
        const result = await runLoggedOperation(store, {
          category: 'analysis',
          operationKey: 'daily-analysis',
          title: '生成投资日报',
          summary: '正在综合账户、持仓与市场依据',
        }, () => createDailyAnalysis(store, { forceRules: Boolean(body.forceRules) }),
        (value) => `投资日报已生成（${value.mode || '规则辅助'}）`);
        sendJson(res, 201, result);
        return;
      }

      if (pathname === '/api/investment/gold/refresh' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await runLoggedOperation(store, {
          category: 'collection',
          operationKey: 'refresh-gold',
          title: '黄金行情更新',
          summary: '正在同步黄金相关行情',
        }, () => refreshGoldMarket(store, { force: Boolean(body.force) }),
        () => '黄金行情已同步');
        sendJson(res, 200, result);
        return;
      }

      if (pathname === '/api/investment/stock-fundamentals' && req.method === 'GET') {
        const codes = requestUrl.searchParams.get('codes');
        const codeList = codes
          ? codes.split(',').map((item) => item.trim()).filter(Boolean)
          : null;
        sendJson(res, 200, { items: readFundamentalsRows(store, codeList) });
        return;
      }

      if (pathname === '/api/investment/stock-fundamentals/refresh' && req.method === 'POST') {
        const body = await readJsonBody(req);
        let holdings;
        if (Array.isArray(body.codes) && body.codes.length) {
          holdings = body.codes.map((code) => ({ stock_code: String(code) }));
        } else {
          // 默认拉取持仓 + 关注的 A 股股票（6/0/3/4/8 开头）；场内基金/ETF（1/5 开头）与
          // 无代码标的没有 A 股财务数据，自动跳过（如恒生科技 513310）
          holdings = store
            .list('portfolio')
            .filter((item) => {
              const code = String(item.stock_code || '').trim();
              if (!/^[03468]\d{5}$/.test(code)) return false;
              if (item.list_type === 'holding') return item.quantity > 0 && !item.closed_at;
              return item.list_type === 'watch';
            });
        }
        if (!holdings.length) {
          throw Object.assign(new Error('没有可采集的股票（持仓或关注需填写 A 股股票代码）'), { statusCode: 400 });
        }
        const result = await runLoggedOperation(store, {
          category: 'collection',
          operationKey: 'refresh-fundamentals',
          title: '基本面更新',
          summary: `正在读取 ${holdings.length} 只股票（持仓与关注）的最新财务报告`,
          metadata: { count: holdings.length },
        }, () => refreshFundamentals(store, holdings, {
          indicator: body.indicator === '按单季度' ? '按单季度' : '按报告期',
        }), (value) => {
          const ok = value.results?.length || 0;
          const failed = value.errors?.length || 0;
          return failed ? `已更新 ${ok} 只，${failed} 只未取得数据` : `已更新 ${ok} 只股票的基本面`;
        });
        sendJson(res, 200, {
          ...result,
          items: readFundamentalsRows(store, holdings.map((item) => item.stock_code)),
        });
        return;
      }

      if (pathname === '/api/investment/quotes/refresh' && req.method === 'POST') {
        const body = await readJsonBody(req);
        let codes;
        if (Array.isArray(body.codes) && body.codes.length) {
          codes = body.codes.map((code) => String(code));
        } else {
          // 默认刷新持仓 + 关注的全部 6 位代码（含场内基金/ETF，如恒生科技 513310）
          codes = store.list('portfolio')
            .filter((item) => {
              const code = String(item.stock_code || '').trim();
              if (!/^\d{6}$/.test(code)) return false;
              if (item.list_type === 'holding') return item.quantity > 0 && !item.closed_at;
              return item.list_type === 'watch';
            })
            .map((item) => String(item.stock_code).trim());
        }
        if (!codes.length) {
          throw Object.assign(new Error('没有可采集的股票（持仓或关注需填写 6 位股票代码）'), { statusCode: 400 });
        }
        const result = await runLoggedOperation(store, {
          category: 'collection',
          operationKey: 'refresh-quotes',
          title: '行情刷新',
          summary: `正在读取 ${codes.length} 只股票的最新行情`,
          metadata: { count: codes.length },
        }, () => collectQuotes(store, codes), (value) => {
          const ok = value.results?.length || 0;
          const failed = value.errors?.length || 0;
          return failed ? `已更新 ${ok} 只行情，${failed} 只未取得数据` : `已更新 ${ok} 只股票的最新行情`;
        });
        sendJson(res, 200, {
          ...result,
          quotes: store.listQuotes(),
        });
        return;
      }

      if (pathname === '/api/investment/analyze-videos' && req.method === 'GET') {
        const restored = restoreTaskStatus(store, 'analyze-videos');
        sendJson(res, 200, {
          running: analyzeTask.running,
          startedAt: analyzeTask.startedAt,
          finishedAt: analyzeTask.finishedAt,
          error: analyzeTask.error,
          log: analyzeTask.log.slice(-4000),
          lastRunAt: restored.lastRunAt || null,
          lastFinishedAt: restored.lastFinishedAt || null,
          lastStatus: restored.lastStatus || null,
          lastSummary: restored.lastSummary || null,
        });
        return;
      }
      if (pathname === '/api/investment/analyze-videos' && req.method === 'POST') {
        if (analyzeTask.running) {
          throw Object.assign(new Error('已有分析任务正在进行，请等待完成'), { statusCode: 409 });
        }
        analyzeTask.running = true;
        analyzeTask.startedAt = new Date().toISOString();
        analyzeTask.finishedAt = null;
        analyzeTask.error = null;
        analyzeTask.log = '';
        analyzeTask.operationFinished = false;
        const operation = store.startOperation({
          category: 'video',
          operationKey: 'analyze-videos',
          title: '视频增量分析',
          summary: '正在扫描新视频、转写并重建研究报告',
        });
        analyzeTask.operationId = operation.id;
        const child = spawn(process.execPath, ['analyze-videos.cjs'], {
          cwd: ROOT,
          env: { ...process.env, KAI_OPERATION_PARENT_ID: String(operation.id) },
        });
        const pushLog = (chunk) => {
          analyzeTask.log += chunk.toString();
          if (analyzeTask.log.length > 20000) analyzeTask.log = analyzeTask.log.slice(-20000);
        };
        child.stdout.on('data', pushLog);
        child.stderr.on('data', pushLog);
        child.on('error', (error) => {
          analyzeTask.running = false;
          analyzeTask.finishedAt = new Date().toISOString();
          analyzeTask.error = `无法启动分析进程：${error.message}`;
          finishBackgroundOperation(store, analyzeTask, {
            status: 'failed',
            summary: analyzeTask.error,
            details: analyzeTask.log || error.stack || error.message,
          });
        });
        child.on('exit', (code) => {
          analyzeTask.running = false;
          analyzeTask.finishedAt = new Date().toISOString();
          if (code !== 0) analyzeTask.error = `分析进程退出码 ${code}`;
          finishBackgroundOperation(store, analyzeTask, {
            status: code === 0 ? 'success' : 'failed',
            summary: code === 0 ? '视频分析与研究报告更新完成' : analyzeTask.error,
            details: analyzeTask.log,
            metadata: { exitCode: code },
          });
        });
        sendJson(res, 202, { ok: true, message: '已开始分析新视频，可在页面查看进度' });
        return;
      }

      const analyzeMatch = pathname.match(/^\/api\/investment\/analyze(?:\/(market|sector))?$/);
      if (analyzeMatch) {
        const scope = analyzeMatch[1] || 'market';
        const task = scope === 'sector' ? sectorAnalyzeTask : marketAnalyzeTask;
        if (req.method === 'GET') {
          sendJson(res, 200, {
            scope: task.scope || scope,
            running: task.running,
            startedAt: task.startedAt,
            finishedAt: task.finishedAt,
            exitCode: task.exitCode,
            error: task.error,
            log: task.log.slice(-4000),
          });
          return;
        }
        if (req.method === 'POST') {
          if (!analyzeMatch[1]) throw Object.assign(new Error('缺少分析范围，如 /api/investment/analyze/market 或 /api/investment/analyze/sector'), { statusCode: 400 });
          if (scope === 'sector') startSectorAnalyzeTask(store, scope);
          else startAnalyzeTask(store, scope);
          sendJson(res, 202, { ok: true, scope, message: scope === 'sector' ? '已开始板块 AI 参考分析，可查看进度' : '已开始市场环境 AI 分析，可查看进度' });
          return;
        }
      }

      const collectMatch = pathname.match(/^\/api\/investment\/collect(?:\/(macro|market|sector|all))?$/);
      if (collectMatch) {
        const scope = collectMatch[1] || 'all';
        if (req.method === 'GET') {
          sendJson(res, 200, {
            running: collectTask.running,
            scope: collectTask.scope,
            startedAt: collectTask.startedAt,
            finishedAt: collectTask.finishedAt,
            exitCode: collectTask.exitCode,
            error: collectTask.error,
            log: collectTask.log.slice(-4000),
          });
          return;
        }
        if (req.method === 'POST') {
          startCollectTask(store, scope);
          const labels = { macro: '宏观变量', market: 'A 股市场环境', sector: '板块行情', all: '全部（宏观+市场+板块）' };
          sendJson(res, 202, { ok: true, scope, message: `已开始采集${labels[scope]}，可查看进度` });
          return;
        }
      }

      const resourceMatch = pathname.match(/^\/api\/investment\/(portfolio|sectors|market|decisions|trades)(?:\/(\d+))?$/);
      if (resourceMatch) {
        const [, resource, id] = resourceMatch;
        if (req.method === 'GET' && !id) {
          sendJson(res, 200, { items: store.list(resource, parseFilters(requestUrl.searchParams)) });
          return;
        }
        if (req.method === 'GET' && id) {
          const item = store.get(resource, id);
          if (!item) throw Object.assign(new Error('记录不存在'), { statusCode: 404 });
          sendJson(res, 200, item);
          return;
        }
        if (req.method === 'POST' && !id) {
          sendJson(res, 201, store.create(resource, await readJsonBody(req), { source: 'manual' }));
          return;
        }
        if (req.method === 'PUT' && id) {
          const body = await readJsonBody(req);
          // 采纳板块 AI 参考建议：只允许写入评级/状态，且留痕可复盘（logic/risks 永不自动改动）
          const adoptFromAi = resource === 'sectors' && Boolean(body.adopt_from_ai);
          const before = adoptFromAi ? store.get(resource, id) : null;
          delete body.adopt_from_ai;
          // 持仓更新：数量变化时强制填写变更原因，并自动生成变更记录
          const result = resource === 'portfolio'
            ? store.updateHoldingWithChange(id, body)
            : { holding: store.update(resource, id, body, { source: 'manual' }) };
          if (adoptFromAi && before) {
            const after = store.get(resource, id);
            const log = store.startOperation({
              category: 'sector',
              operationKey: 'adopt-ai-analysis',
              title: `采纳 AI 参考建议：${before.name}`,
              triggerSource: 'dashboard',
              summary: `评级 ${before.rating} → ${after.rating}；状态「${before.status}」→「${after.status}」；逻辑与风险说明未改动`,
              metadata: {
                sectorId: before.id,
                sectorName: before.name,
                oldRating: before.rating,
                newRating: after.rating,
                oldStatus: before.status,
                newStatus: after.status,
                analysisSource: after.analysis_source || '',
              },
            });
            store.finishOperation(log.id, { status: 'success', summary: `已采纳「${before.name}」AI 参考建议（评级 ${after.rating}/5）` });
          }
          sendJson(res, 200, result);
          return;
        }
        if (req.method === 'DELETE' && id) {
          sendJson(res, 200, { deleted: store.delete(resource, id) });
          return;
        }
        throw Object.assign(new Error('不支持的请求方法'), { statusCode: 405 });
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        throw Object.assign(new Error('不支持的请求方法'), { statusCode: 405 });
      }

      if (pathname === '/' || pathname === '/investment-dashboard.html') {
        sendFile(req, res, DASHBOARD_FILE);
        return;
      }
      // 看板静态资源（CSS/JS），限定在项目根目录下，禁止路径穿越
      if (pathname === '/dashboard.css' || pathname === '/dashboard.js') {
        const filePath = safeResolve(ROOT, pathname.slice(1));
        if (!filePath) throw Object.assign(new Error('禁止访问该路径'), { statusCode: 403 });
        sendFile(req, res, filePath);
        return;
      }
      if (pathname === '/legacy') {
        res.writeHead(302, { Location: '/legacy/' });
        res.end();
        return;
      }
      if (pathname === '/legacy/' || pathname === '/legacy/A股视频看板.html') {
        sendFile(req, res, LEGACY_DASHBOARD_FILE);
        return;
      }
      if (pathname === '/legacy/data.json') {
        sendFile(req, res, path.join(REPORT_DIR, 'data.json'));
        return;
      }
      if (pathname.startsWith('/reports/')) {
        const filePath = safeResolve(REPORT_DIR, pathname.slice('/reports/'.length));
        if (!filePath) throw Object.assign(new Error('禁止访问该路径'), { statusCode: 403 });
        sendFile(req, res, filePath);
        return;
      }
      if (pathname.startsWith('/videos/')) {
        const filePath = safeResolve(VIDEO_DIR, pathname.slice('/videos/'.length));
        if (!filePath) throw Object.assign(new Error('禁止访问该路径'), { statusCode: 403 });
        sendFile(req, res, filePath);
        return;
      }

      sendText(res, 404, 'Not Found');
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      if (statusCode >= 500) {
        // 500 类错误：详情只落日志，对外返回通用文案，避免泄露 SQLite 报错/文件路径/栈信息
        console.error(`请求失败 ${req.method} ${pathname}：${error.message}`);
        sendJson(res, 500, { error: '服务器内部错误，请查看后台日志' });
      } else {
        // 4xx 业务错误（含字段越界、参数缺失、权限拒绝等）：message 经业务层构造，可透传给前端
        sendJson(res, statusCode, { error: error.message || '请求处理失败' });
      }
    }
  });

  server.on('close', () => store.close());
  return { server, store };
}

function runFromCommandLine() {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('--port');
  const initialPort = portIndex >= 0 ? Number(args[portIndex + 1]) : (Number(process.env.PORT) || 4173);
  const autoOpen = !args.includes('--no-open');
  const { server, store } = createAppServer();

  function startListening(port) {
    server.listen(port, '127.0.0.1', () => {
      // 必须与 listen() 的地址保持一致。macOS 上 localhost 可能优先解析到 ::1，
      // 若残留的旧服务恰好监听 IPv6，同一端口会被错误路由到旧进程。
      const url = `http://127.0.0.1:${port}/`;
      log(`AI 投资决策工作台已启动：${url}`);
      log(`视频研究库：${summarizeVideoEvidence(0).totalVideos} 条`);
      log(`数据库：${path.relative(ROOT, store.databasePath)}`);
      log('Ctrl+C 退出');
      if (autoOpen) {
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
      }
    });
  }

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const tried = error.port || initialPort;
      if (tried - initialPort >= 10) {
        console.error(`端口 ${initialPort}–${tried} 都被占用，请用 --port 指定空闲端口`);
        process.exit(1);
      }
      log(`端口 ${tried} 被占用，尝试 ${tried + 1}…`);
      startListening(tried + 1);
      return;
    }
    throw error;
  });

  startListening(initialPort);
  const shutdown = () => {
    // 显式同步关闭 DB 句柄，保证 WAL 有机会 checkpoint；不依赖 server.on('close')，
    // 因为下面的 500ms 兜底可能在 server.close() 完成前就强制 exit。
    store.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) runFromCommandLine();

module.exports = {
  createAppServer,
  checkLocalOrigin,
};
