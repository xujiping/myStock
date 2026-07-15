import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ClipboardList, Clock3, FileText, FileVideo, Home, Library, Menu, Pencil, Plus, RefreshCw, Search, Sparkles, Target, Trash2, TrendingUp, Upload, UserRound, X } from "lucide-react";
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

function TranscriptModal({ video, onClose, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!video) return undefined;
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
  }, [video, onClose]);

  useEffect(() => {
    if (video) {
      setDraft(video.transcript || "");
      setEditing(false);
      setError("");
    }
  }, [video]);

  if (!video) return null;

  const hasTranscript = !!String(video.transcript || "").trim();

  async function handleSave(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(video.id, draft);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="transcript-modal" role="dialog" aria-modal="true" aria-labelledby="transcript-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">转写文字</p>
            <h2 id="transcript-modal-title">{video.original_name}</h2>
            <p className="transcript-modal-sub">{statusText(video.status)} · {hasTranscript ? "可查看或编辑转写内容" : "暂无转写内容，可手动粘贴"}</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="transcript-body">
          {editing ? (
            <form className="transcript-editor-modal" onSubmit={handleSave}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="本地转写未配置或效果不佳时，可把转写文本粘贴在这里" autoFocus />
              {error && <p className="error-text">{error}</p>}
            </form>
          ) : (
            hasTranscript ? (
              <p className="transcript-text">{video.transcript}</p>
            ) : (
              <div className="transcript-empty">
                <FileText size={24} />
                <span>还没有转写内容</span>
                <small>点击编辑可手动粘贴转写文本</small>
              </div>
            )
          )}
        </div>

        <footer className="transcript-actions">
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
          {editing ? (
            <button type="button" className="submit-button" disabled={busy} onClick={handleSave}>
              {busy ? <RefreshCw className="spin" size={18} /> : <CheckCircle2 size={18} />}
              {busy ? "保存中" : "保存转写"}
            </button>
          ) : (
            <button type="button" className="submit-button" onClick={() => setEditing(true)}>
              <Pencil size={16} />
              编辑转写
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function CollapsibleSection({ label, count, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`collapsible-section${open ? " open" : ""}`}>
      <button type="button" className="collapsible-header" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="collapsible-label">
          {icon}
          {label}
          {count > 0 && <small>{count}</small>}
        </span>
        <ChevronDown size={16} className="collapsible-chevron" />
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}

function ConfirmDialog({ title, message, confirmText = "删除", busy, onConfirm, onCancel }) {
  useEffect(() => {
    if (!onConfirm) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onConfirm, onCancel, busy]);

  if (!onConfirm) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-icon"><AlertTriangle size={22} /></div>
        <h2 id="confirm-title">{title}</h2>
        {message && <p>{message}</p>}
        <footer className="confirm-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? "删除中" : confirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}

function EntryCard({ entry, onRefresh, onDelete }) {
  const [openVideo, setOpenVideo] = useState(null);
  const [manualText, setManualText] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [transcriptVideo, setTranscriptVideo] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [retryingVideoId, setRetryingVideoId] = useState("");

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

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === "video") {
        await api(`/api/videos/${pendingDelete.id}`, { method: "DELETE" });
        onRefresh(entry.id);
      } else if (pendingDelete.type === "text") {
        await api(`/api/texts/${pendingDelete.id}`, { method: "DELETE" });
        onRefresh(entry.id);
      } else if (pendingDelete.type === "entry") {
        await api(`/api/entries/${entry.id}`, { method: "DELETE" });
        onDelete(entry.id);
      }
      setPendingDelete(null);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function retryVideo(videoId) {
    setActionError("");
    setRetryingVideoId(videoId);
    try {
      await api(`/api/videos/${videoId}/retry`, { method: "POST" });
      onRefresh(entry.id);
    } catch (error) {
      setActionError(error.message);
    } finally {
      setRetryingVideoId("");
    }
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
      <TranscriptModal
        video={transcriptVideo}
        onClose={() => setTranscriptVideo(null)}
        onSave={async (videoId, text) => {
          await api(`/api/videos/${videoId}/transcript`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text }),
          });
          onRefresh(entry.id);
        }}
      />
      <ConfirmDialog
        title={pendingDelete?.title || "确认删除"}
        message={pendingDelete?.message}
        confirmText="删除"
        busy={deleting}
        onConfirm={pendingDelete ? confirmDelete : null}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
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

      <CollapsibleSection label="视频" count={entry.videos.length} icon={<FileVideo size={16} />}>
        <div className="video-list">
          {entry.videos.map((video) => {
            const isTranscribed = video.status === "transcribed";
            const hasTranscript = !!String(video.transcript || "").trim();
            const canRetry = video.status === "failed";
            const isRetrying = retryingVideoId === video.id;
            return (
              <div className="video-row" key={video.id}>
                <div className="video-row-name">
                  <FileVideo size={17} />
                  <span>{video.original_name}</span>
                </div>
                <div className="video-row-actions">
                  <button
                    className={`tiny-button status-${video.status}`}
                    title={isTranscribed ? "查看转写文字" : "编辑转写"}
                    onClick={() => {
                      if (isTranscribed || hasTranscript) {
                        setTranscriptVideo(video);
                      } else {
                        setOpenVideo(openVideo === video.id ? null : video.id);
                        setManualText(video.transcript || "");
                      }
                    }}
                  >
                    {statusText(video.status)}
                  </button>
                  {canRetry && (
                    <button
                      className="icon-button"
                      title="重新转写"
                      aria-label={`重新转写 ${video.original_name}`}
                      disabled={isRetrying}
                      onClick={() => retryVideo(video.id)}
                    >
                      <RefreshCw className={isRetrying ? "spin" : ""} size={15} />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    title="删除视频"
                    aria-label={`删除 ${video.original_name}`}
                    onClick={() => setPendingDelete({
                      type: "video",
                      id: video.id,
                      title: "删除视频？",
                      message: `将永久删除「${video.original_name}」及其转写文字，且会清空当前归档的 AI 总结。`,
                    })}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {openVideo === video.id && (
                  <div className="transcript-editor">
                    {video.error && <p className="error-text">{video.error}</p>}
                    <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="本地转写未配置或效果不佳时，可把转写文本粘贴在这里" />
                    <button onClick={() => saveTranscript(video.id)}>保存转写</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {!!textNotes.length && (
        <CollapsibleSection label="文本资料" count={textNotes.length} icon={<FileText size={16} />}>
          <section className="text-note-list">
            {textNotes.map((note) => (
              <article className="text-note" key={note.id}>
                <header>
                  <div className="text-note-title">
                    <FileText size={16} />
                    <strong>{note.title || "手动文本"}</strong>
                  </div>
                  <button
                    className="icon-button danger"
                    title="删除文本"
                    aria-label="删除文本"
                    onClick={() => setPendingDelete({
                      type: "text",
                      id: note.id,
                      title: "删除文本？",
                      message: "将永久删除该条文本资料，且会清空当前归档的 AI 总结。",
                    })}
                  >
                    <Trash2 size={15} />
                  </button>
                </header>
                <p>{note.content}</p>
              </article>
            ))}
          </section>
        </CollapsibleSection>
      )}

      <footer>
        <span>{entry.videos.length} 个视频 / {textNotes.length} 条文本</span>
        <div className="footer-actions">
          <button
            className="ghost-button danger"
            title="删除整张归档"
            onClick={() => setPendingDelete({
              type: "entry",
              title: "删除整张归档？",
              message: `将永久删除「${entry.creator_name} · ${entry.entry_date}」下的全部视频、文本和总结，无法恢复。`,
            })}
          >
            <Trash2 size={16} />
            删除归档
          </button>
          <button className="ghost-button" onClick={summarize} disabled={summarizing || materialCount === 0 || incompleteVideos.length > 0}>
            {summarizing ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
            {entry.status === "summarized" ? "重新总结" : "AI 总结"}
          </button>
        </div>
      </footer>
    </article>
  );
}

function TimelineDay({ date, entries, onRefresh, onDelete }) {
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
            <EntryCard key={entry.id} entry={entry} onRefresh={onRefresh} onDelete={onDelete} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DecisionDashboard({ dashboard, loading, refreshing, onRefresh, onCreate, onOpenArchive }) {
  const horizons = dashboard?.horizons || [];
  const totals = dashboard?.totals || {};
  const strategyStatusLabel = {
    new: "首次建立",
    maintain: "延续原方向",
    adjust: "微调方向",
    reverse: "转向",
  };
  const creatorViews = Object.values((dashboard?.recent_entries || []).reduce((groups, entry) => {
    if (!groups[entry.creator_name]) {
      groups[entry.creator_name] = { creator_name: entry.creator_name, entries: [] };
    }
    groups[entry.creator_name].entries.push(entry);
    return groups;
  }, {}));

  return (
    <section className="home-board">
      <header className="home-hero">
        <div>
          <p className="eyebrow">Decision Board</p>
          <h2>投资方向</h2>
          <p>基于每日已总结结论聚合，不重复处理博主原话。</p>
        </div>
        <div className="home-actions">
          <button className="create-button" onClick={onCreate}>
            <Upload size={17} />
            新增资料
          </button>
          <button className="ghost-button" onClick={onRefresh}>
            <RefreshCw className={refreshing ? "spin" : ""} size={17} />
            刷新
          </button>
        </div>
      </header>

      <section className="home-stats" aria-label="观点统计">
        <div>
          <span>近期校准观点卡</span>
          <strong>{totals.summary_count || 0}</strong>
        </div>
        <div>
          <span>覆盖博主</span>
          <strong>{totals.creator_count || 0}</strong>
        </div>
        <div>
          <span>最近日期</span>
          <strong>{totals.latest_date || "暂无"}</strong>
        </div>
      </section>

      {loading ? (
        <div className="empty-state">正在读取决策看板...</div>
      ) : (
        <>
          <section className="decision-grid">
            {horizons.map((horizon) => (
              <article className={`decision-card ${horizon.key}`} key={horizon.key}>
                <header>
                  <div className="decision-icon">
                    {horizon.key === "short" && <Clock3 size={20} />}
                    {horizon.key === "mid" && <Target size={20} />}
                    {horizon.key === "long" && <TrendingUp size={20} />}
                  </div>
                  <div>
                    <p className="eyebrow">目标周期 · {horizon.period}</p>
                    <h2>{horizon.title}方向</h2>
                  </div>
                </header>
                <p className="decision-text">{horizon.focus}</p>
                <p className="decision-suggestion">{horizon.suggestion}</p>

                <section className="strategy-update" aria-label="本次策略判断">
                  <strong>本次判断 · {strategyStatusLabel[horizon.strategy_status] || "首次建立"}</strong>
                  <p>{horizon.adjustment_note}</p>
                </section>

                {(horizon.creator_views || []).length ? (
                  <section className="creator-direction-list" aria-label={`${horizon.title}博主观点`}>
                    <strong>{horizon.key === "short" ? "博主短期观点" : "具备持续性依据的博主观点"}</strong>
                    <ol>
                      {horizon.creator_views.map((creator) => (
                        <li key={creator.creator_name}>
                          <strong>{creator.creator_name}</strong>
                          <span>{creator.views.join("；")}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {(horizon.disagreements || []).length ? (
                  <section className="disagreement-list" aria-label={`${horizon.title}观点分歧`}>
                    <strong>观点分歧</strong>
                    {horizon.disagreements.map((disagreement) => (
                      <p key={disagreement.topic}>
                        <b>{disagreement.topic}</b>
                        <span>{disagreement.viewpoints.join("；")}</span>
                      </p>
                    ))}
                  </section>
                ) : null}

                <section className="caution-list" aria-label="注意事项">
                  <strong>注意事项</strong>
                  {horizon.cautions.map((caution) => <p key={caution}>{caution}</p>)}
                </section>
              </article>
            ))}
          </section>

          <section className="recent-summaries">
            <header>
              <div>
                <p className="eyebrow">Recent Signals</p>
                <h2>近期博主观点</h2>
              </div>
              <button className="ghost-button" onClick={onOpenArchive}>
                <Library size={17} />
                查看归档
              </button>
            </header>
            <div className="creator-view-list">
              {creatorViews.length ? creatorViews.map((creator) => (
                <article className="creator-view" key={creator.creator_name}>
                  <header>
                    <strong>{creator.creator_name}</strong>
                    <span>{creator.entries.length} 条近期观点</span>
                  </header>
                  <ol>
                    {creator.entries.map((entry) => (
                      <li key={entry.id}>
                        <time>{entry.entry_date}</time>
                        <p>{entry.ai_summary}</p>
                      </li>
                    ))}
                  </ol>
                </article>
              )) : (
                <div className="empty-state">还没有已总结的每日观点卡。先在归档中上传资料并点击 AI 总结。</div>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

const ideaDefaults = {
  title: "",
  assetName: "",
  direction: "watch",
  horizon: "mid",
  conviction: 3,
  status: "active",
  thesis: "",
  catalysts: "",
  risks: "",
  tags: "",
};

const ideaDirection = { bullish: "看多", bearish: "看空", watch: "观察" };
const ideaHorizon = { short: "短期", mid: "中期", long: "长期" };
const ideaStatus = { active: "进行中", watching: "持续观察", archived: "已归档", invalidated: "已证伪" };

function IdeaModal({ idea, onClose, onSaved }) {
  const isEditing = Boolean(idea?.id);
  const [draft, setDraft] = useState(isEditing ? { ...idea, tags: (idea.tags || []).join("，") } : ideaDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...draft, conviction: Number(draft.conviction) };
      const saved = await api(isEditing ? `/api/ideas/${idea.id}` : "/api/ideas", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="idea-modal" role="dialog" aria-modal="true" aria-labelledby="idea-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">My Investment Thesis</p>
            <h2 id="idea-modal-title">{isEditing ? "编辑投资观点" : "记录投资观点"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <form className="idea-form" onSubmit={submit}>
          <div className="idea-form-grid">
            <label className="field idea-title-field"><span>观点标题</span><input value={draft.title} onChange={(e) => update("title", e.target.value)} placeholder="例如：AI 服务器需求仍在上行" autoFocus /></label>
            <label className="field"><span>关联标的 / 主题</span><input value={draft.assetName || ""} onChange={(e) => update("assetName", e.target.value)} placeholder="例如：英伟达、算力" /></label>
            <label className="field"><span>判断方向</span><select value={draft.direction} onChange={(e) => update("direction", e.target.value)}>{Object.entries(ideaDirection).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field"><span>观察周期</span><select value={draft.horizon} onChange={(e) => update("horizon", e.target.value)}>{Object.entries(ideaHorizon).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field"><span>当前状态</span><select value={draft.status} onChange={(e) => update("status", e.target.value)}>{Object.entries(ideaStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field"><span>信心程度 · {draft.conviction}/5</span><input type="range" min="1" max="5" step="1" value={draft.conviction} onChange={(e) => update("conviction", e.target.value)} /></label>
          </div>
          <label className="field"><span>核心论据</span><textarea value={draft.thesis} onChange={(e) => update("thesis", e.target.value)} placeholder="为什么形成这个判断？关键假设、事实和推理链是什么？" /></label>
          <div className="idea-form-grid">
            <label className="field"><span>催化因素（可选）</span><textarea value={draft.catalysts || ""} onChange={(e) => update("catalysts", e.target.value)} placeholder="哪些事件会验证观点？" /></label>
            <label className="field"><span>风险与证伪条件（可选）</span><textarea value={draft.risks || ""} onChange={(e) => update("risks", e.target.value)} placeholder="什么情况出现就需要重估？" /></label>
          </div>
          <label className="field"><span>标签（用逗号分隔）</span><input value={draft.tags || ""} onChange={(e) => update("tags", e.target.value)} placeholder="宏观，半导体，业绩" /></label>
          {error && <p className="error-text">{error}</p>}
          <footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="submit-button" disabled={busy}>{busy ? "保存中" : "保存观点"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function IdeasBoard({ ideas, loading, refreshing, query, setQuery, status, setStatus, onRefresh, onCreate, onEdit, onDelete }) {
  const activeCount = ideas.filter((idea) => idea.status === "active").length;
  return (
    <section className="ideas-board">
      <header className="home-hero ideas-hero">
        <div><p className="eyebrow">Personal Research Log</p><h2>我的投资观点</h2><p>把判断、依据和证伪条件放在一起，方便持续跟踪与复盘。</p></div>
        <div className="home-actions"><button className="create-button" onClick={onCreate}><Plus size={18} />记录观点</button><button className="ghost-button" onClick={onRefresh}><RefreshCw className={refreshing ? "spin" : ""} size={17} />刷新</button></div>
      </header>
      <section className="idea-summary"><div><span>全部观点</span><strong>{ideas.length}</strong></div><div><span>进行中</span><strong>{activeCount}</strong></div><div><span>待复核</span><strong>{ideas.filter((idea) => idea.status === "watching").length}</strong></div></section>
      <section className="idea-toolbar">
        <div className="filter-input search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、标的或论据" /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="按状态筛选"><option value="all">全部状态</option>{Object.entries(ideaStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </section>
      {loading ? <div className="empty-state">正在读取观点记录...</div> : (
        <section className="idea-grid">
          {ideas.map((idea) => <article className="idea-card" key={idea.id}>
            <header><div><span className={`idea-direction ${idea.direction}`}>{ideaDirection[idea.direction]}</span><p className="eyebrow">{idea.asset_name || "未关联标的"}</p><h3>{idea.title}</h3></div><button className="icon-button" aria-label="编辑观点" onClick={() => onEdit(idea)}><Pencil size={15} /></button></header>
            <div className="idea-meta"><span>{ideaHorizon[idea.horizon]}</span><span>{ideaStatus[idea.status]}</span><span>信心 {"●".repeat(idea.conviction)}{"○".repeat(5 - idea.conviction)}</span></div>
            <p className="idea-thesis">{idea.thesis}</p>
            {idea.catalysts && <section className="idea-detail"><strong>催化</strong><p>{idea.catalysts}</p></section>}
            {idea.risks && <section className="idea-detail risk"><strong>证伪条件</strong><p>{idea.risks}</p></section>}
            <footer><div className="idea-tags">{(idea.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}</div><button className="text-button danger-text" onClick={() => onDelete(idea)}>删除</button></footer>
          </article>)}
          {!ideas.length && <div className="empty-state">还没有匹配的观点。先记录一个你正在跟踪的判断。</div>}
        </section>
      )}
    </section>
  );
}

function App() {
  const [entries, setEntries] = useState([]);
  const [creators, setCreators] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [view, setView] = useState("home");
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  const [ideasLoading, setIdeasLoading] = useState(true);
  const [ideasRefreshing, setIdeasRefreshing] = useState(false);
  const [ideaQuery, setIdeaQuery] = useState("");
  const [ideaStatusFilter, setIdeaStatusFilter] = useState("all");
  const [ideaModal, setIdeaModal] = useState(null);

  async function loadCreators() {
    const data = await api("/api/creators");
    setCreators(data);
  }

  function replaceEntry(nextEntry) {
    setEntries((current) => current.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)));
  }

  function removeEntry(entryId) {
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    loadDashboard({ quiet: true }).catch(() => {});
  }

  async function refreshEntry(entryId, { syncDashboard = true } = {}) {
    const data = await api(`/api/entries/${entryId}`);
    replaceEntry(data);
    if (syncDashboard) loadDashboard({ quiet: true }).catch(() => {});
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

  async function loadDashboard({ quiet = false } = {}) {
    if (quiet) setDashboardRefreshing(true);
    else setDashboardLoading(true);
    try {
      const data = await api("/api/dashboard");
      setDashboard(data);
    } finally {
      setDashboardLoading(false);
      setDashboardRefreshing(false);
    }
  }

  async function loadIdeas({ quiet = false } = {}) {
    if (quiet) setIdeasRefreshing(true);
    else setIdeasLoading(true);
    try {
      const params = new URLSearchParams();
      if (ideaStatusFilter !== "all") params.set("status", ideaStatusFilter);
      if (ideaQuery.trim()) params.set("query", ideaQuery.trim());
      const data = await api(`/api/ideas${params.size ? `?${params}` : ""}`);
      setIdeas(data);
    } finally {
      setIdeasLoading(false);
      setIdeasRefreshing(false);
    }
  }

  useEffect(() => {
    loadEntries();
    loadCreators();
  }, [date]);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadIdeas(); }, ideaQuery ? 220 : 0);
    return () => clearTimeout(timer);
  }, [ideaStatusFilter, ideaQuery]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [navOpen]);

  useEffect(() => {
    const processingEntryIds = entries
      .filter((entry) => entry.videos?.some(isVideoProcessing))
      .map((entry) => entry.id);
    if (!processingEntryIds.length) return undefined;
    const timer = setInterval(() => {
      processingEntryIds.forEach((entryId) => {
        refreshEntry(entryId, { syncDashboard: false }).catch(() => {});
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

  function switchView(nextView) {
    setView(nextView);
    setNavOpen(false);
  }

  return (
    <main className={`app-shell${navOpen ? " nav-open" : ""}`}>
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={navOpen ? "关闭菜单" : "打开菜单"}
        aria-expanded={navOpen}
        aria-controls="primary-navigation"
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {navOpen && <button type="button" className="nav-scrim" aria-label="关闭菜单遮罩" onClick={() => setNavOpen(false)} />}

      <aside className="side-rail" id="primary-navigation">
        <div className="rail-header">
          <div className="brand-mark">观</div>
          <div>
            <p className="eyebrow">Creator Review</p>
            <h2>观点复盘台</h2>
          </div>
        </div>
        <nav className="rail-nav" aria-label="主导航">
          <button className={view === "home" ? "active" : ""} onClick={() => switchView("home")}>
            <Home size={17} />
            首页
          </button>
          <button className={view === "archive" ? "active" : ""} onClick={() => switchView("archive")}>
            <Library size={17} />
            观点归档
          </button>
          <button className={view === "ideas" ? "active" : ""} onClick={() => switchView("ideas")}>
            <ClipboardList size={17} />
            我的观点
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <UploadModal creators={creators} isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => {
          loadEntries({ quiet: true });
          loadCreators();
          loadDashboard({ quiet: true });
        }} />
        {ideaModal !== null && <IdeaModal idea={ideaModal || null} onClose={() => setIdeaModal(null)} onSaved={() => loadIdeas({ quiet: true })} />}
        {view === "home" ? (
          <DecisionDashboard
            dashboard={dashboard}
            loading={dashboardLoading}
            refreshing={dashboardRefreshing}
            onRefresh={() => loadDashboard({ quiet: true })}
            onCreate={() => setUploadOpen(true)}
            onOpenArchive={() => switchView("archive")}
          />
        ) : view === "ideas" ? (
          <IdeasBoard
            ideas={ideas}
            loading={ideasLoading}
            refreshing={ideasRefreshing}
            query={ideaQuery}
            setQuery={setIdeaQuery}
            status={ideaStatusFilter}
            setStatus={setIdeaStatusFilter}
            onRefresh={() => loadIdeas({ quiet: true })}
            onCreate={() => setIdeaModal({})}
            onEdit={(idea) => setIdeaModal(idea)}
            onDelete={async (idea) => {
              if (!window.confirm(`删除「${idea.title}」？此操作无法恢复。`)) return;
              await api(`/api/ideas/${idea.id}`, { method: "DELETE" });
              setIdeas((current) => current.filter((item) => item.id !== idea.id));
            }}
          />
        ) : (
          <>
            <Filters date={date} setDate={setDate} query={query} setQuery={setQuery} refresh={() => loadEntries({ quiet: true })} onCreate={() => setUploadOpen(true)} />

            <section className="timeline">
              {refreshing && <div className="inline-refresh"><RefreshCw className="spin" size={15} /> 正在更新</div>}
              {initialLoading && <div className="empty-state">正在读取归档...</div>}
              {!initialLoading && timelineDays.length === 0 && <div className="empty-state">还没有归档。上传几个视频后，这里会按日期倒序生成时间线。</div>}
              {timelineDays.map((day) => (
                <TimelineDay key={day.date} date={day.date} entries={day.entries} onRefresh={refreshEntry} onDelete={removeEntry} />
              ))}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
