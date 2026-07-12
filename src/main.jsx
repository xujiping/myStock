import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, CheckCircle2, ClipboardList, FileText, FileVideo, RefreshCw, Search, Sparkles, Trash2, Upload, UserRound, X } from "lucide-react";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5174";

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path, options) {
  const response = await fetch(`${apiBase}${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }
  return response.json();
}

function statusText(status) {
  return {
    uploaded: "已上传",
    extracting_audio: "抽取音频",
    audio_ready: "音频就绪",
    needs_transcription: "待转写",
    transcribing: "转写中",
    transcribed: "已转写",
    failed: "失败",
  }[status] || status;
}

function isVideoProcessing(video) {
  return ["uploaded", "extracting_audio", "audio_ready", "transcribing"].includes(video.status);
}

function fileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function UploadModal({ creators, onUploaded, isOpen, onClose }) {
  const [creatorName, setCreatorName] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [mode, setMode] = useState("video");
  const [files, setFiles] = useState([]);
  const [textContent, setTextContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  function addFiles(nextFiles) {
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      const merged = [...current];
      nextFiles.forEach((file) => {
        if (!seen.has(fileKey(file))) {
          seen.add(fileKey(file));
          merged.push(file);
        }
      });
      return merged;
    });
  }

  function removeFile(key) {
    setFiles((current) => current.filter((file) => fileKey(file) !== key));
  }

  function clearFiles() {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitText() {
    if (!textContent.trim()) {
      setNotice({ type: "error", text: "请粘贴文本内容" });
      return;
    }
    const result = await api("/api/texts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorName,
        entryDate,
        content: textContent,
      }),
    });
    setTextContent("");
    setNotice({
      type: "success",
      text: `文本已加入 ${result.creator.name} / ${result.entry.entry_date}，需要时可手动触发 AI 总结`,
    });
    onUploaded();
  }

  async function submitVideo() {
    if (!files.length) {
      setNotice({ type: "error", text: "请选择至少一个 mp4 视频" });
      return;
    }
    const form = new FormData();
    form.append("creatorName", creatorName);
    form.append("entryDate", entryDate);
    files.forEach((file) => form.append("videos", file));
    const result = await api("/api/upload", { method: "POST", body: form });
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNotice({
      type: "success",
      text: `上传成功：${result.videos.length} 个视频已加入 ${result.creator.name} / ${result.entry.entry_date}，转写完成后可手动触发 AI 总结`,
    });
    onUploaded();
  }

  async function submit(event) {
    event.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "text") await submitText();
      else await submitVideo();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">新增资料</p>
            <h2 id="upload-modal-title">收集到每日观点卡</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭上传窗口" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modal-tabs" role="tablist" aria-label="资料类型">
          <button type="button" role="tab" aria-selected={mode === "video"} className={mode === "video" ? "active" : ""} onClick={() => setMode("video")}>
            <FileVideo size={17} />
            视频
          </button>
          <button type="button" role="tab" aria-selected={mode === "text"} className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
            <ClipboardList size={17} />
            文本
          </button>
        </div>

        <form className="upload-panel" onSubmit={submit}>
          <div className="upload-meta-grid">
            <label className="field">
              <span><UserRound size={16} /> 博主</span>
              <input
                value={creatorName}
                onChange={(event) => setCreatorName(event.target.value)}
                placeholder="搜索或新建博主"
                list="creator-options"
                autoComplete="off"
              />
              <datalist id="creator-options">
                {creators.map((creator) => (
                  <option value={creator.name} key={creator.id} />
                ))}
              </datalist>
            </label>

            <label className="field">
              <span><CalendarDays size={16} /> 日期</span>
              <input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} />
            </label>
          </div>

          <div className="upload-mode-panel">
            {mode === "video" ? (
              <>
                <label className="drop-zone">
                  <span className="drop-zone-icon"><Upload size={24} /></span>
                  <strong>{files.length ? `已选择 ${files.length} 个视频` : "选择或拖入 mp4 视频"}</strong>
                  <small>支持多选；同一天同一博主会合并到同一张归档卡</small>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,.mp4"
                    multiple
                    onChange={(event) => {
                      addFiles(Array.from(event.target.files || []));
                      event.target.value = "";
                    }}
                  />
                </label>

                {files.length > 0 && (
                  <section className="selected-files" aria-label="已选择的视频文件">
                    <header>
                      <span>{files.length} 个待上传视频</span>
                      <button type="button" className="text-button" onClick={clearFiles}>
                        <Trash2 size={15} />
                        清空
                      </button>
                    </header>
                    <div className="selected-file-list">
                      {files.map((file) => (
                        <div className="selected-file" key={fileKey(file)}>
                          <FileVideo size={16} />
                          <span>{file.name}</span>
                          <small>{formatFileSize(file.size)}</small>
                          <button type="button" aria-label={`移除 ${file.name}`} onClick={() => removeFile(fileKey(file))}>
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <section className="text-source">
                <label className="field text-content-field">
                  <span><ClipboardList size={16} /> 文本内容</span>
                  <textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} placeholder="粘贴博主的文字观点、评论、字幕或手动整理的要点" />
                </label>
              </section>
            )}
          </div>

          {notice && (
            <div className={`form-notice ${notice.type}`} role="status">
              {notice.type === "success" && <CheckCircle2 size={18} />}
              <span>{notice.text}</span>
            </div>
          )}

          <footer className="modal-actions">
            <button className="ghost-button" type="button" onClick={onClose}>取消</button>
            <button className="submit-button" type="submit" disabled={busy}>
              {busy ? <RefreshCw className="spin" size={18} /> : mode === "text" ? <ClipboardList size={18} /> : <Upload size={18} />}
              {busy ? "保存中" : mode === "text" ? "保存文本" : "上传并处理"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Filters({ date, setDate, query, setQuery, refresh, onCreate }) {
  return (
    <section className="filters">
      <button className="create-button" onClick={onCreate}>
        <Upload size={17} />
        新增资料
      </button>
      <div className="filter-input">
        <CalendarDays size={17} />
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </div>
      <button className="ghost-button" onClick={() => setDate("")}>全部日期</button>
      <div className="filter-input search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索博主、总结或观点" />
      </div>
      <button className="ghost-button" onClick={refresh}>
        <RefreshCw size={17} />
        刷新
      </button>
    </section>
  );
}

function EntryCard({ entry, onRefresh }) {
  const [openVideo, setOpenVideo] = useState(null);
  const [manualText, setManualText] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [actionError, setActionError] = useState("");

  async function saveTranscript(videoId) {
    setActionError("");
    await api(`/api/videos/${videoId}/transcript`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: manualText }),
    });
    setManualText("");
    setOpenVideo(null);
    onRefresh(entry.id);
  }

  async function summarize() {
    setActionError("");
    setSummarizing(true);
    try {
      await api(`/api/entries/${entry.id}/summarize`, { method: "POST" });
      onRefresh(entry.id);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setSummarizing(false);
    }
  }

  const textNotes = entry.text_notes || [];
  const incompleteVideos = entry.videos.filter((video) => !String(video.transcript || "").trim());
  const readyVideoCount = entry.videos.length - incompleteVideos.length;
  const materialCount = readyVideoCount + textNotes.length;
  const hasCurrentSummary = entry.status === "summarized" && entry.ai_summary;

  return (
    <article className="entry-card">
      <header>
        <div>
          <p className="eyebrow">{entry.entry_date}</p>
          <h2>{entry.creator_name}</h2>
        </div>
        <span className={`entry-status ${entry.status}`}>{entry.status === "summarized" ? "已总结" : "待总结"}</span>
      </header>

      <section className="summary-block">
        <div className="summary-title">
          <Sparkles size={17} />
          <span>注意 / 关注</span>
        </div>
        <p>{hasCurrentSummary ? entry.ai_summary : "先收集视频转写或手动文本；资料足够后点击 AI 总结生成每日观点卡。"}</p>
        {!!incompleteVideos.length && <p className="summary-warning">还有 {incompleteVideos.length} 个视频未完成转写，暂不能总结。</p>}
        {actionError && <p className="error-text">{actionError}</p>}
      </section>

      {entry.status === "summarized" && !!entry.key_points?.length && (
        <section className="core-points">
          <div className="section-label">核心观点</div>
          <ul className="points">
            {entry.key_points.map((point, index) => (
              <li key={`${point}-${index}`}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="video-list">
        {entry.videos.map((video) => (
          <div className="video-row" key={video.id}>
            <div>
              <FileVideo size={17} />
              <span>{video.original_name}</span>
            </div>
            <button className="tiny-button" onClick={() => {
              setOpenVideo(openVideo === video.id ? null : video.id);
              setManualText(video.transcript || "");
            }}>
              {statusText(video.status)}
            </button>
            {openVideo === video.id && (
              <div className="transcript-editor">
                {video.error && <p className="error-text">{video.error}</p>}
                <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="本地转写未配置或效果不佳时，可把转写文本粘贴在这里" />
                <button onClick={() => saveTranscript(video.id)}>保存转写</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!!textNotes.length && (
        <section className="text-note-list">
          <div className="section-label">文本资料</div>
          {textNotes.map((note) => (
            <article className="text-note" key={note.id}>
              <header>
                <FileText size={16} />
                <strong>{note.title || "手动文本"}</strong>
              </header>
              <p>{note.content}</p>
            </article>
          ))}
        </section>
      )}

      <footer>
        <span>{entry.videos.length} 个视频 / {textNotes.length} 条文本</span>
        <button className="ghost-button" onClick={summarize} disabled={summarizing || materialCount === 0 || incompleteVideos.length > 0}>
          {summarizing ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
          {entry.status === "summarized" ? "重新总结" : "AI 总结"}
        </button>
      </footer>
    </article>
  );
}

function TimelineDay({ date, entries, onRefresh }) {
  return (
    <section className="timeline-day">
      <div className="timeline-marker">
        <span>{date.slice(5)}</span>
      </div>
      <div className="timeline-content">
        <header className="day-header">
          <div>
            <p className="eyebrow">Daily Review</p>
            <h2>{date}</h2>
          </div>
          <span>{entries.length} 位博主</span>
        </header>
        <div className="creator-stack">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} onRefresh={onRefresh} />
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [entries, setEntries] = useState([]);
  const [creators, setCreators] = useState([]);
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadCreators() {
    const data = await api("/api/creators");
    setCreators(data);
  }

  function replaceEntry(nextEntry) {
    setEntries((current) => current.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)));
  }

  async function refreshEntry(entryId) {
    const data = await api(`/api/entries/${entryId}`);
    replaceEntry(data);
  }

  async function loadEntries({ quiet = false } = {}) {
    if (quiet) setRefreshing(true);
    else setInitialLoading(true);
    try {
      const data = await api(`/api/entries${date ? `?date=${date}` : ""}`);
      setEntries(data);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadEntries();
    loadCreators();
  }, [date]);

  useEffect(() => {
    const processingEntryIds = entries
      .filter((entry) => entry.videos?.some(isVideoProcessing))
      .map((entry) => entry.id);
    if (!processingEntryIds.length) return undefined;
    const timer = setInterval(() => {
      processingEntryIds.forEach((entryId) => {
        refreshEntry(entryId).catch(() => {});
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) => {
      const haystack = [entry.creator_name, entry.ai_summary, ...(entry.key_points || [])].join(" ").toLowerCase();
      const textHaystack = (entry.text_notes || []).map((note) => `${note.title || ""} ${note.content || ""}`).join(" ").toLowerCase();
      return haystack.includes(keyword) || textHaystack.includes(keyword);
    });
  }, [entries, query]);

  const timelineDays = useMemo(() => {
    const groups = new Map();
    visibleEntries.forEach((entry) => {
      if (!groups.has(entry.entry_date)) groups.set(entry.entry_date, []);
      groups.get(entry.entry_date).push(entry);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([groupDate, groupEntries]) => ({
        date: groupDate,
        entries: groupEntries.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
      }));
  }, [visibleEntries]);

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div className="brand-mark">观</div>
        <div>
          <p className="eyebrow">Creator Review</p>
          <h2>观点复盘台</h2>
        </div>
      </aside>

      <section className="workspace">
        <UploadModal creators={creators} isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => {
          loadEntries({ quiet: true });
          loadCreators();
        }} />
        <Filters date={date} setDate={setDate} query={query} setQuery={setQuery} refresh={() => loadEntries({ quiet: true })} onCreate={() => setUploadOpen(true)} />

        <section className="timeline">
          {refreshing && <div className="inline-refresh"><RefreshCw className="spin" size={15} /> 正在更新</div>}
          {initialLoading && <div className="empty-state">正在读取归档...</div>}
          {!initialLoading && timelineDays.length === 0 && <div className="empty-state">还没有归档。上传几个视频后，这里会按日期倒序生成时间线。</div>}
          {timelineDays.map((day) => (
            <TimelineDay key={day.date} date={day.date} entries={day.entries} onRefresh={refreshEntry} />
          ))}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
