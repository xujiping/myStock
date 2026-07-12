import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { fileURLToPath } from "node:url";
import { all, get, initDb, run } from "./db.js";
import { analyzeDashboard, enqueuePendingVideoProcessing, enqueueVideoProcessing, summarizeEntry } from "./jobs.js";

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

async function ensureCreator(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("请填写博主名称");
  const existing = await get("SELECT * FROM ms_creators WHERE name = ?", [trimmed]);
  if (existing) return existing;
  const id = nanoid();
  await run("INSERT INTO ms_creators (id, name) VALUES (?, ?)", [id, trimmed]);
  return get("SELECT * FROM ms_creators WHERE id = ?", [id]);
}

async function ensureEntry(creatorId, date) {
  const entryDate = date || new Date().toISOString().slice(0, 10);
  const existing = await get("SELECT * FROM ms_entries WHERE creator_id = ? AND entry_date = ?", [creatorId, entryDate]);
  if (existing) return existing;
  const id = nanoid();
  await run("INSERT INTO ms_entries (id, creator_id, entry_date, title) VALUES (?, ?, ?, ?)", [id, creatorId, entryDate, `${entryDate} 观点`]);
  return get("SELECT * FROM ms_entries WHERE id = ?", [id]);
}

async function findIncompleteVideos(entryId) {
  return all(`
    SELECT id, original_name, status
    FROM ms_videos
    WHERE entry_id = ?
      AND (transcript IS NULL OR transcript = '')
    ORDER BY created_at
  `, [entryId]);
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Failed to delete file ${filePath}:`, error);
  }
}

async function resetEntrySummary(entryId) {
  await run("UPDATE ms_entries SET ai_summary = NULL, key_points = NULL, status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [entryId]);
}

async function getEntryDetail(entryId) {
  const entry = await get(`
    SELECT e.*, c.name AS creator_name, c.handle AS creator_handle
    FROM ms_entries e
    JOIN ms_creators c ON c.id = e.creator_id
    WHERE e.id = ?
  `, [entryId]);
  if (!entry) return null;
  return {
    ...entry,
    key_points: typeof entry.key_points === "string" ? JSON.parse(entry.key_points) : entry.key_points || [],
    videos: await all("SELECT * FROM ms_videos WHERE entry_id = ? ORDER BY created_at DESC", [entry.id]),
    text_notes: await all("SELECT * FROM ms_text_notes WHERE entry_id = ? ORDER BY created_at DESC", [entry.id]),
  };
}

function parseKeyPoints(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function daysBetween(dateString, now = new Date()) {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function buildDecisionHorizon({ key, title, days, intent, items, now }) {
  const scopedItems = items.filter((item) => daysBetween(item.entry_date, now) <= days);
  const evidence = scopedItems
    .flatMap((item) => item.key_points.map((point) => ({
      point,
      creator_name: item.creator_name,
      entry_date: item.entry_date,
    })))
    .slice(0, 8);
  const creators = new Set(scopedItems.map((item) => item.creator_id));
  return {
    key,
    title,
    days,
    intent,
    summary_count: scopedItems.length,
    creator_count: creators.size,
    evidence,
    updated_at: scopedItems[0]?.entry_date || null,
    basis: scopedItems.length
      ? `来自近 ${days} 天 ${creators.size} 位博主的 ${scopedItems.length} 张每日观点卡。`
      : `近 ${days} 天还没有可用于决策的已总结观点卡。`,
  };
}

function dashboardSourceSignature(items) {
  const source = items.map((item) => `${item.id}:${item.entry_date}:${new Date(item.updated_at).toISOString()}`).join("|");
  return createHash("sha256").update(source).digest("hex");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const rows = await all(`
      SELECT e.id, e.creator_id, e.entry_date, e.ai_summary, e.key_points, e.updated_at, c.name AS creator_name
      FROM ms_entries e
      JOIN ms_creators c ON c.id = e.creator_id
      WHERE e.status = 'summarized'
        AND e.ai_summary IS NOT NULL
        AND e.ai_summary != ''
      ORDER BY e.entry_date DESC, e.updated_at DESC
      LIMIT 240
    `);
    const items = rows.map((row) => ({
      ...row,
      key_points: parseKeyPoints(row.key_points),
    }));
    const now = new Date();
    const baseHorizons = [
      buildDecisionHorizon({ key: "short", title: "短期", days: 7, intent: "短期执行", items, now }),
      buildDecisionHorizon({ key: "mid", title: "中期", days: 30, intent: "中期配置", items, now }),
      buildDecisionHorizon({ key: "long", title: "长期", days: 90, intent: "长期主线", items, now }),
    ];
    const sourceSignature = dashboardSourceSignature(items);
    const cached = await get("SELECT source_signature, model, analysis, generated_at FROM ms_dashboard_analyses WHERE scope_key = 'default'");
    let cachedAnalysis = cached?.analysis;
    if (typeof cachedAnalysis === "string") {
      try {
        cachedAnalysis = JSON.parse(cachedAnalysis);
      } catch {
        cachedAnalysis = null;
      }
    }

    let analysis = cachedAnalysis;
    let analysisModel = cached?.model || null;
    let generatedAt = cached?.generated_at || null;
    if (!cached || cached.source_signature !== sourceSignature) {
      const generated = await analyzeDashboard(baseHorizons.map((horizon) => ({ ...horizon, items: items.filter((item) => daysBetween(item.entry_date, now) <= horizon.days) })));
      analysis = generated.analysis;
      analysisModel = generated.model;
      generatedAt = new Date().toISOString();
      await run(`
        INSERT INTO ms_dashboard_analyses (scope_key, source_signature, model, analysis)
        VALUES ('default', ?, ?, ?)
        ON DUPLICATE KEY UPDATE source_signature = VALUES(source_signature), model = VALUES(model), analysis = VALUES(analysis), generated_at = CURRENT_TIMESTAMP
      `, [sourceSignature, analysisModel, JSON.stringify(analysis)]);
    }

    const analysisByKey = new Map((analysis?.horizons || []).map((horizon) => [horizon.key, horizon]));
    const horizons = baseHorizons.map((horizon) => ({
      ...horizon,
      ...analysisByKey.get(horizon.key),
      focus: analysisByKey.get(horizon.key)?.focus || "样本不足，暂不形成独立关注方向。",
      suggestion: analysisByKey.get(horizon.key)?.suggestion || "补齐更多已总结的每日观点卡后再评估。",
      cautions: analysisByKey.get(horizon.key)?.cautions || ["当前样本不足，不应据此形成仓位决策。"],
    }));
    res.json({
      generated_at: now.toISOString(),
      totals: {
        summary_count: items.length,
        creator_count: new Set(items.map((item) => item.creator_id)).size,
        latest_date: items[0]?.entry_date || null,
      },
      horizons,
      analysis: { model: analysisModel, generated_at: generatedAt, source_signature: sourceSignature },
      recent_entries: items.slice(0, 8).map((item) => ({
        id: item.id,
        creator_name: item.creator_name,
        entry_date: item.entry_date,
        ai_summary: item.ai_summary,
        key_points: item.key_points.slice(0, 3),
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/creators", async (_req, res, next) => {
  try {
    const creators = await all(`
      SELECT c.id, c.name, c.handle, c.note, c.created_at, COALESCE(vc.video_count, 0) AS video_count
      FROM ms_creators c
      LEFT JOIN (
        SELECT e.creator_id, COUNT(v.id) AS video_count
        FROM ms_entries e
        LEFT JOIN ms_videos v ON v.entry_id = e.id
        GROUP BY e.creator_id
      ) vc ON vc.creator_id = c.id
      ORDER BY c.created_at DESC
    `);
    res.json(creators);
  } catch (error) {
    next(error);
  }
});

app.get("/api/entries", async (req, res, next) => {
  try {
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
    const entries = await all(sql, params);
    const entriesWithVideos = await Promise.all(entries.map((entry) => getEntryDetail(entry.id)));
    res.json(entriesWithVideos);
  } catch (error) {
    next(error);
  }
});

app.get("/api/entries/:id", async (req, res, next) => {
  try {
    const entry = await getEntryDetail(req.params.id);
    if (!entry) return res.status(404).json({ error: "归档不存在" });
    res.json(entry);
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.array("videos", 50), async (req, res) => {
  try {
    const creator = await ensureCreator(req.body.creatorName);
    const entry = await ensureEntry(creator.id, req.body.entryDate);
    const files = req.files || [];
    const videos = [];
    for (const file of files) {
      const id = nanoid();
      const originalName = normalizeOriginalName(file.originalname);
      await run(`
      INSERT INTO ms_videos (id, entry_id, original_name, video_path, status)
      VALUES (?, ?, ?, ?, 'uploaded')
    `, [id, entry.id, originalName, file.path]);
      enqueueVideoProcessing(id);
      videos.push({ id, original_name: originalName });
    }
    await run("UPDATE ms_entries SET ai_summary = NULL, key_points = NULL, status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [entry.id]);
    res.json({ creator, entry, videos });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.post("/api/texts", async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    if (!content) throw new Error("请粘贴文本内容");
    const creator = await ensureCreator(req.body.creatorName);
    const entry = await ensureEntry(creator.id, req.body.entryDate);
    const id = nanoid();
    const title = String(req.body.title || "").trim() || "手动文本";
    await run(`
      INSERT INTO ms_text_notes (id, entry_id, title, content)
      VALUES (?, ?, ?, ?)
    `, [id, entry.id, title, content]);
    await run("UPDATE ms_entries SET ai_summary = NULL, key_points = NULL, status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [entry.id]);
    res.json({ creator, entry, text: { id, title, content } });
  } catch (error) {
    res.status(400).json({ error: String(error.message || error) });
  }
});

app.patch("/api/videos/:id/transcript", async (req, res, next) => {
  try {
    const video = await get("SELECT * FROM ms_videos WHERE id = ?", [req.params.id]);
    if (!video) return res.status(404).json({ error: "视频不存在" });
    await run("UPDATE ms_videos SET transcript = ?, status = 'transcribed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [String(req.body.transcript || ""), req.params.id]);
    await run("UPDATE ms_entries SET ai_summary = NULL, key_points = NULL, status = 'collecting', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [video.entry_id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/entries/:id/summarize", async (req, res, next) => {
  try {
    const entry = await get("SELECT * FROM ms_entries WHERE id = ?", [req.params.id]);
    if (!entry) return res.status(404).json({ error: "归档不存在" });
    const incompleteVideos = await findIncompleteVideos(entry.id);
    if (incompleteVideos.length) {
      return res.status(409).json({
        error: `还有 ${incompleteVideos.length} 个视频未完成转写，不能总结。请等待转写完成或手动保存转写文本。`,
        videos: incompleteVideos,
      });
    }
    const digest = await summarizeEntry(entry.id);
    res.json(digest);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/videos/:id", async (req, res, next) => {
  try {
    const video = await get("SELECT * FROM ms_videos WHERE id = ?", [req.params.id]);
    if (!video) return res.status(404).json({ error: "视频不存在" });
    await run("DELETE FROM ms_videos WHERE id = ?", [req.params.id]);
    await Promise.all([safeUnlink(video.video_path), safeUnlink(video.audio_path)]);
    await resetEntrySummary(video.entry_id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/texts/:id", async (req, res, next) => {
  try {
    const note = await get("SELECT * FROM ms_text_notes WHERE id = ?", [req.params.id]);
    if (!note) return res.status(404).json({ error: "文本不存在" });
    await run("DELETE FROM ms_text_notes WHERE id = ?", [req.params.id]);
    await resetEntrySummary(note.entry_id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/entries/:id", async (req, res, next) => {
  try {
    const entry = await get("SELECT * FROM ms_entries WHERE id = ?", [req.params.id]);
    if (!entry) return res.status(404).json({ error: "归档不存在" });
    const videos = await all("SELECT video_path, audio_path FROM ms_videos WHERE entry_id = ?", [entry.id]);
    await run("DELETE FROM ms_entries WHERE id = ?", [entry.id]);
    await Promise.all(videos.flatMap((video) => [safeUnlink(video.video_path), safeUnlink(video.audio_path)]));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
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

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: String(error.message || error) });
});

await initDb();
const resumedVideoCount = await enqueuePendingVideoProcessing();
if (resumedVideoCount) {
  console.log(`Resumed ${resumedVideoCount} pending video transcription job(s).`);
}

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
