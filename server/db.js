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

  // 航天图谱：资料源（上传的视频/文字，抽取的输入）
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_sources (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      title VARCHAR(255),
      source_type VARCHAR(16) NOT NULL DEFAULT 'text',
      video_path VARCHAR(1024),
      audio_path VARCHAR(1024),
      transcript LONGTEXT,
      extraction JSON,
      status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
      error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ms_aerospace_sources_category_created (category, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  // 航天图谱：公司档案（规范化，可手动修正）
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_companies (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      name VARCHAR(255) NOT NULL,
      ticker VARCHAR(64),
      role VARCHAR(255),
      business_mix JSON,
      source_ids JSON,
      manual_override TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ms_aerospace_companies_cat_name (category, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  // 航天图谱：零部件
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_components (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      code VARCHAR(16),
      name VARCHAR(255) NOT NULL,
      description VARCHAR(512),
      cost_share VARCHAR(32),
      art VARCHAR(32),
      source_ids JSON,
      manual_override TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ms_aerospace_components_cat_name (category, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  // 航天图谱：公司-零部件关联（多对多）
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_company_links (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      component_id VARCHAR(32) NOT NULL,
      company_id VARCHAR(32) NOT NULL,
      source_ids JSON,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ms_aerospace_links_comp_company (component_id, company_id),
      INDEX idx_ms_aerospace_links_company (company_id),
      CONSTRAINT fk_ms_aerospace_links_component FOREIGN KEY (component_id) REFERENCES ${tablePrefix}aerospace_components(id) ON DELETE CASCADE,
      CONSTRAINT fk_ms_aerospace_links_company FOREIGN KEY (company_id) REFERENCES ${tablePrefix}aerospace_companies(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  // 航天图谱：整体成本结构
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_cost_breakdown (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      name VARCHAR(255) NOT NULL,
      share DECIMAL(5,2),
      color VARCHAR(32),
      sort_order INT NOT NULL DEFAULT 0,
      source_ids JSON,
      manual_override TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ms_aerospace_cost_cat_name (category, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${charset}_unicode_ci
  `);

  // 航天图谱：分段说明
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tablePrefix}aerospace_stages (
      id VARCHAR(32) PRIMARY KEY,
      category VARCHAR(32) NOT NULL DEFAULT 'rocket',
      code VARCHAR(16) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description VARCHAR(512),
      sort_order INT NOT NULL DEFAULT 0,
      source_ids JSON,
      manual_override TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ms_aerospace_stages_cat_code (category, code)
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
