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

CREATE TABLE IF NOT EXISTS aero_sync_pipeline_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pipeline_key VARCHAR(64) NOT NULL,
  run_date DATE NOT NULL,
  trigger_source VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  current_task VARCHAR(64) NULL,
  retry_at DATETIME NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_aero_sync_pipeline_date (pipeline_key, run_date, trigger_source),
  KEY idx_aero_sync_pipeline_status (status, retry_at)
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

CREATE TABLE IF NOT EXISTS aero_financial_profit (
  company_id BIGINT UNSIGNED NOT NULL,
  report_year SMALLINT UNSIGNED NOT NULL,
  report_quarter TINYINT UNSIGNED NOT NULL,
  metrics_json JSON NOT NULL,
  source_name VARCHAR(64) NOT NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, report_year, report_quarter),
  KEY idx_aero_financial_profit_period (report_year, report_quarter),
  CONSTRAINT fk_aero_financial_profit_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
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

-- 数据源控制面：API、文件、智能体和搜索渠道通过同一注册、能力和运行记录模型接入。
CREATE TABLE IF NOT EXISTS aero_data_source (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(64) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  source_type VARCHAR(24) NOT NULL,
  access_mode VARCHAR(24) NOT NULL,
  trust_level VARCHAR(16) NOT NULL DEFAULT 'medium',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  config_json JSON NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_data_source_key (source_key),
  KEY idx_aero_data_source_status (status, source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_data_source_capability (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  capability_key VARCHAR(64) NOT NULL,
  capability_name VARCHAR(128) NOT NULL,
  output_contract VARCHAR(32) NOT NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_source_capability (source_id, capability_key),
  KEY idx_aero_source_capability_lookup (capability_key, is_active, priority),
  CONSTRAINT fk_aero_source_capability_source FOREIGN KEY (source_id) REFERENCES aero_data_source(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_data_source_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  capability_key VARCHAR(64) NOT NULL,
  run_key VARCHAR(128) NOT NULL,
  trigger_type VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  artifacts_found INT UNSIGNED NOT NULL DEFAULT 0,
  records_proposed INT UNSIGNED NOT NULL DEFAULT 0,
  records_adopted INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_source_run_key (source_id, run_key),
  KEY idx_aero_source_run_recent (source_id, capability_key, started_at),
  KEY idx_aero_source_run_status (status, started_at),
  CONSTRAINT fk_aero_source_run_source FOREIGN KEY (source_id) REFERENCES aero_data_source(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_data_artifact (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  source_run_id BIGINT UNSIGNED NULL,
  artifact_key VARCHAR(255) NOT NULL,
  artifact_type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NULL,
  source_url VARCHAR(1024) NULL,
  published_at DATE NULL,
  content_hash CHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_data_artifact_source_key (source_id, artifact_key),
  KEY idx_aero_data_artifact_run (source_run_id, artifact_type),
  CONSTRAINT fk_aero_data_artifact_source FOREIGN KEY (source_id) REFERENCES aero_data_source(id),
  CONSTRAINT fk_aero_data_artifact_run FOREIGN KEY (source_run_id) REFERENCES aero_data_source_run(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_data_artifact_link (
  artifact_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  relation_type VARCHAR(32) NOT NULL DEFAULT 'evidence',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (artifact_id, entity_type, entity_id, relation_type),
  KEY idx_aero_artifact_link_entity (entity_type, entity_id),
  CONSTRAINT fk_aero_artifact_link_artifact FOREIGN KEY (artifact_id) REFERENCES aero_data_artifact(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 商业航天业务画像：分类字典、公司暴露、业务关联、证据与人工修改历史。
CREATE TABLE IF NOT EXISTS aero_space_sector (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sector_code VARCHAR(32) NOT NULL,
  sector_name VARCHAR(128) NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  sector_level TINYINT UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_space_sector_code (sector_code),
  UNIQUE KEY uk_aero_space_sector_name_parent (sector_name, parent_id),
  KEY idx_aero_space_sector_parent (parent_id, is_active, sort_order),
  CONSTRAINT fk_aero_space_sector_parent FOREIGN KEY (parent_id) REFERENCES aero_space_sector(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_company_space_profile (
  company_id BIGINT UNSIGNED NOT NULL,
  commercial_revenue_exact DECIMAL(8,4) NULL,
  commercial_revenue_min DECIMAL(8,4) NULL,
  commercial_revenue_max DECIMAL(8,4) NULL,
  commercial_revenue_state VARCHAR(24) NOT NULL DEFAULT '待确认',
  commercial_revenue_confidence VARCHAR(8) NOT NULL DEFAULT '低',
  commercial_profit_note TEXT NULL,
  non_space_core_businesses JSON NULL,
  business_summary TEXT NULL,
  source_name VARCHAR(128) NULL,
  source_url VARCHAR(1024) NULL,
  source_date DATE NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  is_manual_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id),
  KEY idx_aero_space_profile_state (commercial_revenue_state, commercial_revenue_confidence),
  CONSTRAINT fk_aero_space_profile_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 公司级画像证据：保存自动研究任务的全部原始来源，不与单条当前画像来源互相覆盖。
CREATE TABLE IF NOT EXISTS aero_company_space_profile_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  evidence_key CHAR(64) NOT NULL,
  evidence_title VARCHAR(255) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  source_url VARCHAR(1024) NULL,
  published_at DATE NULL,
  source_level VARCHAR(32) NOT NULL,
  excerpt TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aero_space_profile_evidence_company_key (company_id, evidence_key),
  KEY idx_aero_space_profile_evidence_company_date (company_id, published_at),
  CONSTRAINT fk_aero_space_profile_evidence_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_company_space_business (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  sector_id BIGINT UNSIGNED NOT NULL,
  business_role VARCHAR(16) NOT NULL,
  business_status VARCHAR(32) NOT NULL DEFAULT '待确认',
  space_revenue_exact DECIMAL(8,4) NULL,
  space_revenue_min DECIMAL(8,4) NULL,
  space_revenue_max DECIMAL(8,4) NULL,
  company_revenue_exact DECIMAL(8,4) NULL,
  company_revenue_min DECIMAL(8,4) NULL,
  company_revenue_max DECIMAL(8,4) NULL,
  data_state VARCHAR(24) NOT NULL DEFAULT '待确认',
  confidence VARCHAR(8) NOT NULL DEFAULT '低',
  chain_scope VARCHAR(128) NULL,
  chain_value_exact DECIMAL(8,4) NULL,
  chain_value_min DECIMAL(8,4) NULL,
  chain_value_max DECIMAL(8,4) NULL,
  chain_value_basis VARCHAR(128) NULL,
  chain_importance TINYINT UNSIGNED NULL,
  company_importance TINYINT UNSIGNED NULL,
  source_name VARCHAR(128) NULL,
  source_url VARCHAR(1024) NULL,
  source_date DATE NULL,
  research_note TEXT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_space_business_company (company_id, is_current, business_role),
  KEY idx_aero_space_business_sector (sector_id, is_current),
  KEY idx_aero_space_business_state (data_state, confidence),
  CONSTRAINT fk_aero_space_business_company FOREIGN KEY (company_id) REFERENCES aero_company(id),
  CONSTRAINT fk_aero_space_business_sector FOREIGN KEY (sector_id) REFERENCES aero_space_sector(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_space_business_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  evidence_title VARCHAR(255) NOT NULL,
  source_name VARCHAR(128) NOT NULL,
  source_url VARCHAR(1024) NULL,
  published_at DATE NULL,
  data_state VARCHAR(24) NOT NULL DEFAULT '待确认',
  excerpt TEXT NULL,
  is_adopted TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_space_evidence_business (business_id, is_adopted, published_at),
  CONSTRAINT fk_aero_space_evidence_business FOREIGN KEY (business_id) REFERENCES aero_company_space_business(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_space_profile_revision (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(48) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(24) NOT NULL,
  field_name VARCHAR(128) NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  change_reason TEXT NULL,
  operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  is_manual TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aero_space_revision_company (company_id, created_at),
  CONSTRAINT fk_aero_space_revision_company FOREIGN KEY (company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS aero_space_sector_daily (
  sector_id BIGINT UNSIGNED NOT NULL,
  trade_date DATE NOT NULL,
  equal_change_pct DECIMAL(12,6) NULL,
  weighted_change_pct DECIMAL(12,6) NULL,
  rising_count INT UNSIGNED NOT NULL DEFAULT 0,
  falling_count INT UNSIGNED NOT NULL DEFAULT 0,
  flat_count INT UNSIGNED NOT NULL DEFAULT 0,
  high_exposure_count INT UNSIGNED NOT NULL DEFAULT 0,
  leader_company_id BIGINT UNSIGNED NULL,
  laggard_company_id BIGINT UNSIGNED NULL,
  top_contributor_company_id BIGINT UNSIGNED NULL,
  concentration_state VARCHAR(16) NOT NULL DEFAULT '待确认',
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sector_id, trade_date),
  KEY idx_aero_space_sector_daily_date (trade_date, equal_change_pct),
  CONSTRAINT fk_aero_space_daily_sector FOREIGN KEY (sector_id) REFERENCES aero_space_sector(id),
  CONSTRAINT fk_aero_space_daily_leader FOREIGN KEY (leader_company_id) REFERENCES aero_company(id),
  CONSTRAINT fk_aero_space_daily_laggard FOREIGN KEY (laggard_company_id) REFERENCES aero_company(id),
  CONSTRAINT fk_aero_space_daily_contributor FOREIGN KEY (top_contributor_company_id) REFERENCES aero_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
