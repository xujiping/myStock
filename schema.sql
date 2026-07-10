CREATE TABLE IF NOT EXISTS aero_company (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stock_code VARCHAR(12) NOT NULL,
  company_name VARCHAR(128) NOT NULL,
  exchange VARCHAR(16) NULL,
  related_level VARCHAR(32) NOT NULL DEFAULT '待确认',
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_company_code (stock_code),
  KEY idx_aero_company_active (is_active, related_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_company_tag (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  tag_type VARCHAR(20) NOT NULL,
  tag_name VARCHAR(128) NOT NULL,
  source_name VARCHAR(64) NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_company_tag_period (company_id, tag_type, tag_name, effective_from),
  KEY idx_aero_tag_name (tag_type, tag_name),
  CONSTRAINT fk_aero_tag_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_sync_checkpoint (
  checkpoint_key VARCHAR(128) NOT NULL,
  checkpoint_value TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (checkpoint_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_sync_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_key VARCHAR(64) NOT NULL,
  task_label VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  records_written INT NOT NULL DEFAULT 0,
  warning_count INT NOT NULL DEFAULT 0,
  retry_at DATETIME NULL,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_aero_sync_run_task_time (task_key, started_at),
  KEY idx_aero_sync_run_status (status, retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_sync_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sync_run_id BIGINT UNSIGNED NOT NULL,
  log_level VARCHAR(12) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_sync_log_run_time (sync_run_id, created_at),
  CONSTRAINT fk_aero_sync_log_run FOREIGN KEY (sync_run_id) REFERENCES aero_sync_run(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_daily_quote (
  company_id BIGINT UNSIGNED NOT NULL,
  trade_date DATE NOT NULL,
  open_price DECIMAL(18,4) NULL,
  high_price DECIMAL(18,4) NULL,
  low_price DECIMAL(18,4) NULL,
  close_price DECIMAL(18,4) NULL,
  change_pct DECIMAL(12,6) NULL,
  volume DECIMAL(24,4) NULL,
  turnover DECIMAL(24,4) NULL,
  turnover_rate DECIMAL(12,6) NULL,
  market_cap DECIMAL(24,4) NULL,
  pe_ttm DECIMAL(18,6) NULL,
  pb DECIMAL(18,6) NULL,
  source_name VARCHAR(64) NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, trade_date),
  KEY idx_aero_quote_date (trade_date),
  CONSTRAINT fk_aero_quote_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_board_quote (
  board_key VARCHAR(64) NOT NULL,
  board_name VARCHAR(128) NOT NULL,
  board_type VARCHAR(20) NOT NULL,
  trade_date DATE NOT NULL,
  close_value DECIMAL(18,4) NULL,
  change_pct DECIMAL(12,6) NULL,
  turnover DECIMAL(24,4) NULL,
  rising_count INT NULL,
  falling_count INT NULL,
  leader_code VARCHAR(12) NULL,
  leader_name VARCHAR(128) NULL,
  source_name VARCHAR(64) NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (board_key, trade_date),
  KEY idx_aero_board_date (trade_date, board_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_announcement (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  external_key VARCHAR(255) NOT NULL,
  title VARCHAR(512) NOT NULL,
  published_at DATETIME NOT NULL,
  source_name VARCHAR(64) NOT NULL,
  source_url VARCHAR(1024) NULL,
  content_hash CHAR(64) NULL,
  raw_content MEDIUMTEXT NULL,
  ai_summary TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_announcement_source_key (source_name, external_key),
  KEY idx_aero_announcement_company_time (company_id, published_at),
  CONSTRAINT fk_aero_announcement_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NULL,
  announcement_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NULL,
  risk_level VARCHAR(8) NOT NULL DEFAULT '低',
  title VARCHAR(512) NOT NULL,
  detail TEXT NULL,
  announced_at DATETIME NOT NULL,
  planned_start_date DATE NULL,
  planned_end_date DATE NULL,
  planned_quantity DECIMAL(24,6) NULL,
  completed_quantity DECIMAL(24,6) NULL,
  evidence_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_event_company_time (company_id, announced_at),
  KEY idx_aero_event_status (event_type, status),
  CONSTRAINT fk_aero_event_company FOREIGN KEY (company_id) REFERENCES aero_company(id),
  CONSTRAINT fk_aero_event_announcement FOREIGN KEY (announcement_id) REFERENCES aero_announcement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_event_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NOT NULL,
  old_status VARCHAR(32) NULL,
  new_status VARCHAR(32) NOT NULL,
  changed_at DATETIME NOT NULL,
  evidence_announcement_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_aero_event_status_history_event (event_id, changed_at),
  CONSTRAINT fk_aero_status_event FOREIGN KEY (event_id) REFERENCES aero_event(id),
  CONSTRAINT fk_aero_status_announcement FOREIGN KEY (evidence_announcement_id) REFERENCES aero_announcement(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_business_fact (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  fact_type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  fact_state VARCHAR(24) NOT NULL DEFAULT '当前',
  source_name VARCHAR(64) NULL,
  source_url VARCHAR(1024) NULL,
  disclosed_at DATE NULL,
  content_hash CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_business_company (company_id, fact_type, fact_state),
  CONSTRAINT fk_aero_business_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_macro_indicator (
  indicator_key VARCHAR(64) NOT NULL,
  indicator_name VARCHAR(128) NOT NULL,
  observed_date DATE NOT NULL,
  value DECIMAL(24,8) NULL,
  value_text VARCHAR(255) NULL,
  change_pct DECIMAL(12,6) NULL,
  unit VARCHAR(32) NULL,
  source_name VARCHAR(64) NULL,
  source_url VARCHAR(1024) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (indicator_key, observed_date),
  KEY idx_aero_macro_date (observed_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_report (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_date DATE NOT NULL,
  report_type VARCHAR(16) NOT NULL,
  markdown_path VARCHAR(1024) NULL,
  pdf_path VARCHAR(1024) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'generated',
  data_cutoff_at DATETIME NULL,
  content_hash CHAR(64) NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_report_date_type (report_date, report_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_ingestion_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_date DATE NOT NULL,
  task_name VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  records_written INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_aero_ingestion_date (run_date, task_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
