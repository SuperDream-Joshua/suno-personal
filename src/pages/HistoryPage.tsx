import { useState, useEffect, useRef, useCallback } from "react";
import type { HistoryItem, HistoryTrack } from "@/types";
import { getHistory } from "@/services/api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 格式化秒数为 m:ss */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 将嵌套对象平铺为 key: value 列表 */
function flattenInput(
  obj: Record<string, unknown>,
  prefix = "",
): { key: string; value: string }[] {
  const result: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      result.push(
        ...flattenInput(v as Record<string, unknown>, fullKey),
      );
    } else {
      result.push({
        key: fullKey,
        value: Array.isArray(v) ? v.join(", ") : String(v ?? ""),
      });
    }
  }
  return result;
}

/** Input 详情弹窗 */
function InputModal({
  item,
  onClose,
}: {
  item: HistoryItem;
  onClose: () => void;
}) {
  const entries = flattenInput(item.input);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl shadow-2xl w-[480px] max-w-[90vw] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold">
            输入参数 — {item.title || item.taskId.slice(0, 8)}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {entries.length === 0 ? (
            <p className="text-sm text-text-secondary">无参数信息</p>
          ) : (
            <div className="space-y-3">
              {entries.map(({ key, value }) => (
                <div key={key}>
                  <span className="text-xs text-text-secondary/60">{key}</span>
                  <p className="text-sm text-text mt-0.5 break-all">{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<HistoryItem | null>(null);

  /** 当前正在播放的 audio 元素引用，用于互斥 */
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      setError(null);
      const data = await getHistory();
      setItems(data.history);
    } catch (err: any) {
      setError(err.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">创作历史</h2>
          <p className="text-text-secondary text-sm mt-1">
            查看你的所有 AI 音乐作品
          </p>
        </div>
        {!loading && (
          <button
            onClick={() => {
              setLoading(true);
              fetchHistory();
            }}
            className="px-3 py-1.5 text-xs text-text-secondary bg-surface-light border border-border rounded-lg hover:text-text transition-colors"
          >
            刷新
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <svg
            className="animate-spin w-6 h-6 text-primary"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">⚠️</p>
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              fetchHistory();
            }}
            className="mt-4 px-4 py-2 text-xs bg-surface-light border border-border rounded-lg hover:text-text text-text-secondary transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🎵</p>
          <p className="text-text-secondary text-sm">暂无创作记录</p>
          <p className="text-text-secondary/50 text-xs mt-1">
            去创作页面开始你的第一首歌吧
          </p>
        </div>
      )}

      {/* History Cards */}
      {!loading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.taskId}
              className="p-4 bg-surface-light border border-border rounded-xl hover:border-surface-lighter transition-colors"
            >
              {/* Top row */}
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div className="w-10 h-10 rounded-lg bg-surface-lighter flex items-center justify-center text-lg shrink-0">
                  {item.instrumental ? "🎹" : "🎤"}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium truncate">
                      {item.title || item.taskId.slice(0, 8)}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-lighter text-text-secondary shrink-0">
                      {item.mode === "inspiration" ? "灵感" : "自定义"}
                    </span>
                    {item.instrumental && (
                      <span className="text-[10px] text-text-secondary/60 bg-surface-lighter px-1.5 py-0.5 rounded shrink-0">
                        纯音乐
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {item.tags && (
                      <span className="text-xs text-text-secondary">
                        {item.tags}
                      </span>
                    )}
                    <span className="text-xs text-text-secondary/50">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </div>

                {/* 查看参数按钮 */}
                <button
                  onClick={() => setModalItem(item)}
                  className="p-1.5 text-text-secondary/40 hover:text-primary transition-colors shrink-0"
                  title="查看输入参数"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>

              {/* Tracks */}
              <div className="mt-3 space-y-2 pl-13">
                {item.tracks.map((track) => (
                  <TrackRow
                    key={track.index}
                    track={track}
                    showLabel={item.tracks.length > 1}
                    currentAudioRef={currentAudioRef}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input 参数弹窗 */}
      {modalItem && (
        <InputModal item={modalItem} onClose={() => setModalItem(null)} />
      )}
    </div>
  );
}

/** 单个音轨行组件，管理自己的 duration 状态 */
function TrackRow({
  track,
  showLabel,
  currentAudioRef,
}: {
  track: HistoryTrack;
  showLabel: boolean;
  currentAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
}) {
  const [duration, setDuration] = useState<number | null>(track.duration);

  function handlePlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = e.currentTarget;
    if (currentAudioRef.current && currentAudioRef.current !== audio) {
      try {
        currentAudioRef.current.pause();
      } catch {}
    }
    currentAudioRef.current = audio;
  }

  function handleEnded(e: React.SyntheticEvent<HTMLAudioElement>) {
    if (currentAudioRef.current === e.currentTarget) {
      currentAudioRef.current = null;
    }
  }

  /** 播放时用浏览器解析的真实时长覆盖 */
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const d = e.currentTarget.duration;
    if (d && isFinite(d)) {
      setDuration(d);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {showLabel && (
        <span className="text-xs text-text-secondary w-12 shrink-0">
          Track {track.index}
        </span>
      )}

      <audio
        controls
        className="flex-1 h-8"
        src={track.url}
        preload="none"
        onPlay={handlePlay}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
      >
        <track kind="captions" />
      </audio>

      {/* Duration */}
      <span className="text-xs text-text-secondary shrink-0 w-10 text-right">
        {duration !== null ? formatDuration(duration) : "--:--"}
      </span>

      {/* Size */}
      <span className="text-xs text-text-secondary/70 shrink-0">
        {formatSize(track.size)}
      </span>

      {/* Download */}
      <a
        href={track.url}
        download
        className="p-1.5 text-text-secondary hover:text-primary transition-colors shrink-0"
        title="下载"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
        </svg>
      </a>
    </div>
  );
}
