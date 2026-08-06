#!/usr/bin/env node
/*
 * 投资数据库备份脚本。
 *
 * 做三件事：
 *   1. WAL checkpoint —— 把 -wal 里堆积的写入合并回主库，避免备份时漏数据。
 *   2. Online Backup —— 用 SQLite 的 .backup 指令做热备份（写入中也能安全复制），
 *      生成单个完整 .sqlite 文件（不带 -wal/-shm），可直接单独使用。
 *   3. 清理旧备份 —— 只保留最近 N 份，防止备份目录无限增长。
 *
 * 用法：
 *   node scripts/backup-investment.cjs                  # 立即备份一次，默认保留 30 份
 *   node scripts/backup-investment.cjs --keep 14        # 保留最近 14 份
 *   node scripts/backup-investment.cjs --no-checkpoint  # 跳过 WAL checkpoint
 *   node scripts/backup-investment.cjs --list           # 只列出已有备份
 *
 * 备份位置：data/backup/investment-YYYYMMDD-HHmmss.sqlite
 * 同一天重复运行会覆盖当天已有的备份（按天去重）。
 */
require('dotenv').config();

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'investment.sqlite');
const BACKUP_DIR = path.join(ROOT, 'data', 'backup');

const args = process.argv.slice(2);
const { installOperationLogger } = require('../operation-log.cjs');
installOperationLogger({
  category: 'system',
  operationKey: args.includes('--list') ? 'list-backups' : 'backup-database',
  title: args.includes('--list') ? '查看数据库备份' : '投资数据库备份',
});
const get = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 用 sqlite3 命令行做 WAL checkpoint，把 -wal 合并回主库。 */
function checkpoint(dbPath) {
  // TRUNCATE 模式：合并后立即清空 -wal 文件
  // wal_checkpoint 返回 [busy, log_pages, checkpointed_pages]
  const out = execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return out;
}

/** 用 SQLite 的 .backup 做在线热备份（即使正在写入也安全）。 */
function backup(dbPath, destPath) {
  // .backup 命令会在一个事务里导出完整且一致的数据库快照
  execFileSync('sqlite3', [dbPath, `.backup '${destPath}'`], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** 列出备份目录里的备份文件，按时间从新到旧。 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^investment-\d{8}-\d{6}\.sqlite$/.test(f))
    .map((f) => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/** 按天去重：同一天只保留最新一份，再保留最近 keep 份。 */
function prune(keep) {
  const all = listBackups();
  if (all.length === 0) return { removed: [] };

  // 先按天分组，每天只留最新一份
  const byDay = new Map();
  for (const b of all) {
    const day = b.name.slice(11, 19); // YYYYMMDD
    if (!byDay.has(day) || b.mtime > byDay.get(day).mtime) byDay.set(day, b);
  }
  const deduped = [...byDay.values()].sort((a, b) => b.mtime - a.mtime);

  // 同一天里被淘汰的旧文件（带更早的时间戳）
  const redundant = all.filter((b) => !deduped.includes(b));

  // 超出 keep 份数的旧备份
  const overflow = deduped.slice(keep);

  const removed = [...redundant, ...overflow];
  for (const f of removed) {
    try { fs.unlinkSync(f.path); } catch {}
  }
  return { removed };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const dbPath = process.env.INVESTMENT_DB_PATH || DEFAULT_DB_PATH;

  if (args.includes('--list')) {
    const backups = listBackups();
    if (backups.length === 0) {
      console.log('（暂无备份）');
    } else {
      console.log(`备份目录：${BACKUP_DIR}`);
      for (const b of backups) {
        const size = fs.statSync(b.path).size;
        console.log(`  ${b.name}\t${humanSize(size)}`);
      }
      console.log(`\n共 ${backups.length} 份`);
    }
    return;
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`✗ 找不到数据库：${dbPath}`);
    process.exit(1);
  }

  await fsp.mkdir(BACKUP_DIR, { recursive: true });

  const keep = Number(get('--keep', '30'));
  const doCheckpoint = !args.includes('--no-checkpoint');

  // 1. WAL checkpoint
  if (doCheckpoint) {
    try {
      const result = checkpoint(dbPath);
      console.log(`✓ WAL checkpoint 完成（${result}）`);
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        console.log(`   -wal 大小：${humanSize(fs.statSync(walPath).size)}`);
      }
    } catch (error) {
      console.warn(`⚠ WAL checkpoint 失败（不影响备份，但建议检查）：${error.message}`);
    }
  }

  // 2. 备份（按天去重：同一天覆盖）
  const destName = `investment-${dayKey()}-${ts().slice(9)}.sqlite`;
  const destPath = path.join(BACKUP_DIR, destName);
  backup(dbPath, destPath);
  const size = fs.statSync(destPath).size;
  console.log(`✓ 已备份 → ${destName}（${humanSize(size)}）`);

  // 3. 清理旧备份
  const { removed } = prune(keep);
  if (removed.length > 0) {
    console.log(`✓ 清理 ${removed.length} 份旧备份（保留最近 ${keep} 天）`);
    for (const r of removed) console.log(`   - ${r.name}`);
  }

  const remaining = listBackups();
  console.log(`\n备份目录：${BACKUP_DIR}`);
  console.log(`当前共 ${remaining.length} 份备份。`);
}

main().catch((error) => {
  console.error('备份失败：', error);
  process.exit(1);
});
