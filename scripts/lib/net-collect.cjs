/*
 * 数据采集公共工具。
 *
 * 封装项目里两类联网操作，供 collect-*.cjs 复用：
 *   1. curl + iconv：新浪行情（GBK）、静态 JSON
 *   2. CDP Proxy（web-access skill 提供的 localhost:3456）：动态渲染页面
 *      （东方财富资金流向 / MarketWatch 美元指数 / Yahoo 美债 / 美联储官网）
 *
 * 设计原则：
 *   - 失败不抛异常终止流程，而是返回 { ok, value, error }，让调用方决定降级策略
 *   - 所有抓取都带超时，避免 launchd 任务挂死
 *   - 不打印任何凭据；CDP 只在自己创建的后台 tab 操作，用完即关
 */
require('dotenv').config();

const { execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const CDP_BASE = process.env.CDP_PROXY_URL || 'http://localhost:3456';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * 单次 curl 调用（不含重试）。返回错误分类，供 curl() 决定是否重试。
 * @returns {{ ok:boolean, body:string, error?:string, kind?:'timeout'|'network'|'empty' }}
 */
function curlOnce(url, options) {
  const args = ['-s', '--max-time', String(Math.ceil(options.timeoutMs / 1000)), '-A', UA];
  if (options.referer) args.push('-H', `Referer: ${options.referer}`);
  for (const [k, v] of Object.entries(options.headers)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  let rawBuf;
  try {
    // 必须保留 Buffer，避免先按 utf8 解码损坏 GBK 字节
    rawBuf = execFileSync('curl', args, { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // curl 退出码 28=超时，6=DNS，7=连接失败；统一归类，让上层对瞬时故障重试
    const code = err.status;
    const kind = code === 28 ? 'timeout' : 'network';
    return { ok: false, body: '', error: `curl 失败（退出码 ${code}）：${err.message}`, kind };
  }
  if (!rawBuf || rawBuf.length < 2) return { ok: false, body: '', error: 'curl 返回空内容', kind: 'empty' };
  if (options.gbk) {
    try {
      const decoded = execFileSync('iconv', ['-f', 'GBK', '-t', 'UTF-8'], { input: rawBuf, stdio: ['pipe', 'pipe', 'ignore'] });
      return { ok: true, body: decoded.toString('utf8') };
    } catch (err) {
      return { ok: false, body: '', error: `iconv 失败：${err.message}` };
    }
  }
  return { ok: true, body: rawBuf.toString('utf8') };
}

/**
 * 用 curl 拉取 URL，可选 GBK→UTF-8 转码。
 * 对超时/网络瞬时故障自动重试 1 次（退避 1.5s）；空内容与解码错误不重试。
 * @returns {{ ok:boolean, body:string, error?:string }}
 */
function curl(url, options = {}) {
  const {
    referer = '',
    gbk = false,
    timeoutMs = 12000,
    headers = {},
    retries = 1,
  } = options;
  const opts = { referer, gbk, timeoutMs, headers };
  let result = curlOnce(url, opts);
  // 仅对瞬时故障（timeout/network）重试；empty 与解码错误直接返回
  for (let attempt = 0; attempt < retries && !result.ok && result.kind === 'timeout'; attempt++) {
    const backoff = 1500 * (attempt + 1);
    execFileSync('sleep', [String(backoff / 1000)], { stdio: 'ignore' });
    result = curlOnce(url, opts);
  }
  // 去掉内部 kind 字段，保持对外接口稳定
  if (result.ok) return { ok: true, body: result.body };
  const { ok, body, error } = result;
  return { ok, body, error };
}

/**
 * 用 fetch 拉取 JSON（用于阿里云 AppCode 之类的直连接口已在各模块内实现，这里供通用场景）。
 */
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true, value: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? '请求超时' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── CDP Proxy 封装 ──────────────────────────────────────────────

async function cdp(pathname, options = {}) {
  const { method = 'GET', body, query = {} } = options;
  const qs = new URLSearchParams(query).toString();
  const url = `${CDP_BASE}/${pathname}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    // CDP Proxy 的 /eval 期望 text/plain 表达式（与 curl -d 一致）。
    // 因此 body 始终以原始字符串发送；非字符串才序列化为 JSON 并标记 application/json。
    const isString = typeof body === 'string';
    const resp = await fetch(url, {
      method,
      body: body != null ? (isString ? body : JSON.stringify(body)) : undefined,
      headers: body != null && !isString ? { 'Content-Type': 'application/json' } : (isString ? { 'Content-Type': 'text/plain' } : undefined),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!resp.ok) return { ok: false, error: `CDP ${pathname} HTTP ${resp.status}`, body: json };
    return { ok: true, value: json };
  } catch (err) {
    return { ok: false, error: `CDP 不可用：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查 CDP Proxy 是否就绪（web-access skill 提供）。
 * @returns {{ ok:boolean, error?:string }}
 */
async function cdpReady() {
  const r = await cdp('targets');
  if (!r.ok) {
    return {
      ok: false,
      error: `CDP Proxy 未就绪（${r.error}）。请先运行：node "${process.env.CLAUDE_SKILL_DIR || '~/.agents/skills/web-access'}/scripts/check-deps.mjs"`,
    };
  }
  return { ok: true };
}

/**
 * 打开一个后台 tab，等待加载完成，返回 targetId。
 */
async function openTab(url, { waitMs = 3500 } = {}) {
  const r = await cdp('new', { query: { url } });
  if (!r.ok) return r;
  const targetId = r.value && r.value.targetId;
  if (!targetId) return { ok: false, error: 'CDP 未返回 targetId' };
  await sleep(waitMs);
  return { ok: true, targetId };
}

/**
 * 在 tab 内执行 JS 表达式，返回 { ok, value }。失败时把 error 透传。
 * 注意 expr 如果含特殊字符，调用方应先用 encodeURIComponent。
 */
async function evalInTab(targetId, expr) {
  const r = await cdp('eval', { method: 'POST', query: { target: String(targetId) }, body: expr });
  if (!r.ok) return r;
  const val = r.value;
  if (val && val.error) return { ok: false, error: `eval 异常：${val.error}` };
  return { ok: true, value: val && val.value };
}

async function closeTab(targetId) {
  await cdp('close', { query: { target: String(targetId) } });
}

/**
 * 打开页面 → eval 取数 → 关闭。失败也保证关闭 tab。
 * @param {string} url
 * @param {string} expr  JS 表达式，结果会被 JSON.stringify
 * @returns {Promise<{ok:boolean, value?:any, error?:string}>}
 */
async function scrapePage(url, expr, options = {}) {
  const { waitMs = 3500 } = options;
  const ready = await cdpReady();
  if (!ready.ok) return ready;
  const opened = await openTab(url, { waitMs });
  if (!opened.ok) return opened;
  const { targetId } = opened;
  try {
    const fullExpr = `(function(){try{return JSON.stringify(${expr});}catch(e){return 'ERR:'+e.message;}})()`;
    const r = await evalInTab(targetId, fullExpr);
    if (!r.ok) return r;
    const raw = String(r.value == null ? '' : r.value);
    if (raw.startsWith('ERR:')) return { ok: false, error: raw };
    if (raw === '') return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: true, value: raw };
    }
  } finally {
    await closeTab(targetId);
  }
}

module.exports = {
  UA,
  curl,
  fetchJson,
  cdp,
  cdpReady,
  openTab,
  evalInTab,
  closeTab,
  scrapePage,
  sleep,
};
