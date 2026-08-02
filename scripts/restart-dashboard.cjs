#!/usr/bin/env node
/*
 * 看板一键重启脚本。
 *
 * 做三件事：
 *   1. 找到占用目标端口的旧 serve 进程并停止（先 SIGTERM，超时再 SIGKILL）。
 *   2. 以脱离终端的方式重新启动看板服务（detached，日志写入 logs/serve-<port>.log）。
 *   3. 轮询 /api/health 确认服务就绪。
 *
 * 用法：
 *   node scripts/restart-dashboard.cjs                  # 重启主看板（默认 4173，不打开浏览器）
 *   node scripts/restart-dashboard.cjs --port 4174      # 重启指定端口
 *   node scripts/restart-dashboard.cjs --open           # 就绪后打开浏览器
 *   node scripts/restart-dashboard.cjs --all            # 停止所有 serve 实例后重启主看板
 *
 * 注意：由本脚本启动的进程已 detached + unref，关闭终端后仍会继续运行。
 */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 4173;

const args = process.argv.slice(2);
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(get('--port', String(DEFAULT_PORT)));
const openBrowser = args.includes('--open');
const stopAll = args.includes('--all');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`无效端口：${port}`);
  process.exit(1);
}

function findServePids() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const pids = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    if (m[2].includes('serve.cjs') && m[2].includes('node')) pids.push(pid);
  }
  return pids;
}

function findPidByPort(targetPort) {
  try {
    // -sTCP:LISTEN：只找监听端口的进程，避免把浏览器的客户端连接也算进来
    const out = execFileSync('lsof', ['-ti', `tcp:${targetPort}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return out.split('\n').map((line) => line.trim()).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function isServeProcess(pid) {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return out.includes('serve.cjs');
  } catch {
    return false;
  }
}

function stopProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`已发送停止信号：PID ${pid}`);
  } catch {
    return; // 进程已不存在
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      console.log(`进程已退出：PID ${pid}`);
      return;
    }
    execFileSync('sleep', ['0.1']);
  }
  try {
    process.kill(pid, 'SIGKILL');
    console.log(`进程未按时退出，已强制结束：PID ${pid}`);
  } catch {
    // 已在等待期间退出
  }
}

function startServer(targetPort) {
  const logDir = path.join(ROOT, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, `serve-${targetPort}.log`), 'a');
  const argsList = ['--disable-warning=ExperimentalWarning', 'serve.cjs', '--no-open'];
  if (targetPort !== DEFAULT_PORT) argsList.push('--port', String(targetPort));
  const child = spawn(process.execPath, argsList, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  console.log(`已启动：http://127.0.0.1:${targetPort}/ （PID ${child.pid}，日志 logs/serve-${targetPort}.log）`);
}

function waitForHealth(targetPort, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`服务在 ${timeoutMs / 1000} 秒内未就绪`));
        return;
      }
      const req = http.get({
        host: '127.0.0.1',
        port: targetPort,
        path: '/api/health',
        timeout: 1500,
      }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else setTimeout(attempt, 500);
      });
      req.on('error', () => setTimeout(attempt, 500));
      req.on('timeout', () => {
        req.destroy();
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

async function main() {
  if (stopAll) {
    const all = findServePids();
    if (all.length) {
      console.log(`发现 ${all.length} 个 serve 实例，全部停止：${all.join(', ')}`);
      for (const pid of all) stopProcess(pid);
    } else {
      console.log('没有运行中的 serve 实例。');
    }
  } else {
    const pids = findPidByPort(port);
    if (pids.length) {
      const servePids = pids.filter(isServeProcess);
      const otherPids = pids.filter((pid) => !servePids.includes(pid));
      if (otherPids.length) {
        console.error(`端口 ${port} 被非 serve 进程占用（PID ${otherPids.join(', ')}），拒绝重启，请先处理。`);
        process.exit(1);
      }
      for (const pid of servePids) stopProcess(pid);
    } else {
      console.log(`端口 ${port} 没有旧实例，直接启动。`);
    }
  }

  startServer(port);

  try {
    await waitForHealth(port);
    console.log(`看板服务就绪：http://127.0.0.1:${port}/`);
  } catch (error) {
    console.error(`启动可能失败：${error.message}`);
    console.error(`请查看 logs/serve-${port}.log`);
    process.exit(1);
  }

  if (openBrowser) {
    try {
      execFileSync('open', [`http://127.0.0.1:${port}/`]);
      console.log('已在浏览器打开看板。');
    } catch (error) {
      console.error(`打开浏览器失败：${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
