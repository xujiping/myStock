import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "mystock.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS ms_creators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    handle TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ms_entries (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    title TEXT,
    ai_summary TEXT,
    key_points TEXT,
    review_note TEXT,
    status TEXT NOT NULL DEFAULT 'collecting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (creator_id, entry_date),
    FOREIGN KEY (creator_id) REFERENCES ms_creators(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ms_videos (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    video_path TEXT NOT NULL,
    audio_path TEXT,
    transcript TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES ms_entries(id) ON DELETE CASCADE
  );
`);

export function touchEntry(entryId) {
  db.prepare("UPDATE ms_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(entryId);
}
