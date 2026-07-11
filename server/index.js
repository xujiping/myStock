import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { processVideo, summarizeEntry } from "./jobs.js";

const app = express();
const port = Number(process.env.PORT || 5174);
const uploadDir = path.resolve("uploads/videos");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${nanoid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.originalname.toLowerCase().endsWith(".mp4")) cb(null, true);
    else cb(new Error("只支持视频文件"));
  },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.resolve("uploads")));

function normalizeOriginalName(name) {
  const raw = String(name || "未命名视频.mp4");
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  if (decoded && !decoded.includes("�") && /[\u4e00-\u9fa5]/.test(decoded)) return decoded;
  return raw;
}

function ensureCreator(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("请填写博主名称");
  const existing = db.prepare("SELECT * FROM ms_creators WHERE name = ?").get(trimmed);
  if (existing) return existing;
  const id = nanoid();
  db.prepare("INSERT INTO ms_creators (id, name) VALUES (?, ?)").run(id, trimmed);
  return db.prepare("SELECT * FROM ms_creators WHERE id = ?").get(id);
}

function ensureEntry(creatorId, date) {
  const entryDate = date || new Date().toISOString().slice(0, 10);
  const existing = db.prepare("SELECT * FROM ms_entries WHERE creator_id = ? AND entry_date = ?").get(creatorId, entryDate);
  if (existing) return existing;
  const id = nanoid();
  db.prepare("INSERT INTO ms_entries (id, creator_id, entry_date, title) VALUES (?, ?, ?, ?)").run(id, creatorId, entryDate, `${entryDate} 观点`);
  return db.prepare("SELECT * FROM ms_entries WHERE id = ?").get(id);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/creators", (_req, res) => {
  const creators = db.prepare(`
    SELECT c.*, COUNT(v.id) AS video_count
    FROM ms_creators c
    LEFT JOIN ms_entries e ON e.creator_id = c.id
    LEFT JOIN ms_videos v ON v.entry_id = e.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  res.json(creators);
});

app.get("/api/entries", (req, res) => {
  const { date, creatorId } = req.query;
  const where = [];
  const params = [];
  if (date) {
    where.push("e.entry_date = ?");
    params.push(date);
  }
  if (creatorId) {
    where.push("e.creator_id = ?");
    params.push(creatorId);
  }
  const sql = `
    SELECT e.*, c.name AS creator_name, c.handle AS creator_handle
    FROM ms_entries e
    JOIN ms_creators c ON c.id = e.creator_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY e.entry_date DESC, e.updated_at DESC
  `;
  const entries = db.prepare(sql).all(...params).map((entry) => ({
    ...entry,
    key_points: entry.key_points ? JSON.parse(entry.key_points) : [],
    videos: db.prepare("SELECT * FROM ms_videos WHERE entry_id = ? ORDER BY created_at DESC").all(entry.id),
  }));
  res.json(entries);
});

app.post("/api/upload", upload.array("videos", 50), async (req, res) => {
  try {
    const creator = ensureCreator(req.body.creatorName);
    const entry = ensureEntry(creator.id, req.body.entryDate);
    const files = req.files || [];
    const insert = db.prepare(`
      INSERT INTO ms_videos (id, entry_id, original_name, video_path, status)
      VALUES (?, ?, ?, ?, 'uploaded')
    `);
    const videos = files.map((file) => {
      const id = nanoid();
      const originalName = normalizeOriginalName(file.originalname);
      insert.run(id, entry.id, originalName, file.path);
      processVideo(id);
      return { id, original_name: originalName };
    });
    res.json({ creator, entry, videos });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.patch("/api/videos/:id/transcript", (req, res) => {
  const video = db.prepare("SELECT * FROM ms_videos WHERE id = ?").get(req.params.id);
  if (!video) return res.status(404).json({ error: "视频不存在" });
  db.prepare("UPDATE ms_videos SET transcript = ?, status = 'transcribed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(String(req.body.transcript || ""), req.params.id);
  summarizeEntry(video.entry_id);
  res.json({ ok: true });
});

app.post("/api/entries/:id/summarize", async (req, res) => {
  const entry = db.prepare("SELECT * FROM ms_entries WHERE id = ?").get(req.params.id);
  if (!entry) return res.status(404).json({ error: "归档不存在" });
  const digest = await summarizeEntry(entry.id);
  res.json(digest);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
