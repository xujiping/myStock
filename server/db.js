import mysql from "mysql2/promise";

const tablePrefix = "ms_";
const dbName = process.env.DB_NAME || "fast-commo";
const charset = process.env.DB_CHARSET || "utf8mb4";

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z0-9_-]+$/.test(identifier)) {
    throw new Error(`Invalid database identifier: ${identifier}`);
  }
  return `\`${identifier.replaceAll("`", "``")}\``;
}

async function createPool() {
  const baseConfig = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    charset,
    timezone: process.env.DB_TIMEZONE || "+08:00",
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    namedPlaceholders: false,
  };

  const bootstrap = await mysql.createConnection(baseConfig);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(dbName)} CHARACTER SET ${charset} COLLATE ${charset}_unicode_ci`);
  await bootstrap.end();

  return mysql.createPool({
    ...baseConfig,
    database: dbName,
  });
}

export const db = await createPool();

export async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}creators (
      id VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      handle VARCHAR(255),
      note TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}entries (
      id VARCHAR(32) PRIMARY KEY,
      creator_id VARCHAR(32) NOT NULL,
      entry_date VARCHAR(10) NOT NULL,
      title VARCHAR(255),
      ai_summary TEXT,
      key_points JSON,
      review_note TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'collecting',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_creator_date (creator_id, entry_date),
      CONSTRAINT fk_ms_entries_creator FOREIGN KEY (creator_id) REFERENCES ${tablePrefix}creators(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}videos (
      id VARCHAR(32) PRIMARY KEY,
      entry_id VARCHAR(32) NOT NULL,
      original_name VARCHAR(1024) NOT NULL,
      video_path VARCHAR(1024) NOT NULL,
      audio_path VARCHAR(1024),
      transcript LONGTEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
      error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ms_videos_entry_created (entry_id, created_at),
      CONSTRAINT fk_ms_videos_entry FOREIGN KEY (entry_id) REFERENCES ${tablePrefix}entries(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}text_notes (
      id VARCHAR(32) PRIMARY KEY,
      entry_id VARCHAR(32) NOT NULL,
      title VARCHAR(255),
      content LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ms_text_notes_entry_created (entry_id, created_at),
      CONSTRAINT fk_ms_text_notes_entry FOREIGN KEY (entry_id) REFERENCES ${tablePrefix}entries(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}dashboard_analyses (
      scope_key VARCHAR(32) PRIMARY KEY,
      source_signature CHAR(64) NOT NULL,
      model VARCHAR(255) NOT NULL,
      analysis JSON NOT NULL,
      generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}investment_direction_states (
      horizon_key VARCHAR(32) PRIMARY KEY,
      source_signature CHAR(64) NOT NULL,
      model VARCHAR(255) NOT NULL,
      direction JSON NOT NULL,
      generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}investment_direction_revisions (
      id VARCHAR(32) PRIMARY KEY,
      horizon_key VARCHAR(32) NOT NULL,
      source_signature CHAR(64) NOT NULL,
      model VARCHAR(255) NOT NULL,
      strategy_status VARCHAR(32) NOT NULL,
      previous_direction JSON,
      direction JSON NOT NULL,
      adjustment_note TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ms_direction_revisions_horizon_created (horizon_key, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}investment_ideas (
      id VARCHAR(32) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      asset_name VARCHAR(255),
      direction VARCHAR(24) NOT NULL DEFAULT 'watch',
      horizon VARCHAR(24) NOT NULL DEFAULT 'mid',
      conviction TINYINT UNSIGNED NOT NULL DEFAULT 3,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      thesis TEXT NOT NULL,
      catalysts TEXT,
      risks TEXT,
      tags JSON,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ms_investment_ideas_status_updated (status, updated_at),
      INDEX idx_ms_investment_ideas_asset (asset_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);
}

export async function all(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

export async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

export async function run(sql, params = []) {
  const [result] = await db.execute(sql, params);
  return result;
}

export async function touchEntry(entryId) {
  await run("UPDATE ms_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [entryId]);
}
