import { useState, useEffect, useCallback } from "react";
import type { TaskRecord, TaskStatus } from "@/types";
import { loadTasks, updateTask, removeTask } from "@/services/store";
import { getTaskStatus } from "@/services/api";

const STATUS_MAP: Record<TaskStatus, { label: string; cls: string }> = {
  Pending: {
    label: "排队中",
    cls: "bg-text-secondary/15 text-text-secondary",
  },
  Running: {
    label: "生成中",
    cls: "bg-accent-orange/15 text-accent-orange",
  },
  Success: {
    label: "已完成",
    cls: "bg-accent-green/15 text-accent-green",
  },
  Failure: {
    label: "失败",
    cls: "bg-red-500/15 text-red-400",
  },
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);

  function handleAudioPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    const w = window as any;
    if (w.__currentAudio && w.__currentAudio !== a) {
      try {
        w.__currentAudio.pause();
      } catch {}
    }
    w.__currentAudio = a;
  }

  function handleAudioEnded(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    const w = window as any;
    if (w.__currentAudio === a) {
      w.__currentAudio = null;
    }
  }

  const refresh = useCallback(() => {
    setTasks(loadTasks());
  }, []);

  // 初始加载
  useEffect(() => {
    refresh();
    setLoading(false);
  }, [refresh]);

  // 自动轮询未完成的任务
  useEffect(() => {
    const pending = tasks.filter(
      (t) => t.status === "Pending" || t.status === "Running",
    );
    if (pending.length === 0) return;

    const interval = setInterval(async () => {
      for (const task of pending) {
        try {
          const res = await getTaskStatus(task.taskId);
          const s = res.output.task_status;
          if (s !== task.status || (res.output.urls && res.output.urls.length > 0)) {
            updateTask(task.taskId, {
              status: s,
              urls: res.output.urls ?? task.urls,
              finishTime: res.output.finish_time,
              errorMessage: res.output.error_message,
            });
            refresh();
          }
        } catch {
          // 静默失败，下次重试
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [tasks, refresh]);

  function handleDelete(taskId: string) {
    removeTask(taskId);
    refresh();
  }

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
        {tasks.length > 0 && (
          <button
            onClick={refresh}
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

      {/* Empty */}
      {!loading && tasks.length === 0 && (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🎵</p>
          <p className="text-text-secondary text-sm">暂无创作记录</p>
          <p className="text-text-secondary/50 text-xs mt-1">
            去创作页面开始你的第一首歌吧
          </p>
        </div>
      )}

      {/* Task List */}
      {!loading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((task) => {
            const status = STATUS_MAP[task.status];

            return (
              <div
                key={task.taskId}
                className="p-4 bg-surface-light border border-border rounded-xl hover:border-surface-lighter transition-colors group"
              >
                {/* Top row */}
                <div className="flex items-center gap-3">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-lg bg-surface-lighter flex items-center justify-center text-lg shrink-0">
                    {task.instrumental ? "🎹" : "🎤"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium truncate">
                        {task.title}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${status.cls}`}
                      >
                        {status.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-lighter text-text-secondary shrink-0">
                        {task.mode === "inspiration" ? "灵感" : "自定义"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {task.tags && (
                        <span className="text-xs text-text-secondary">
                          {task.tags}
                        </span>
                      )}
                      {task.instrumental && (
                        <span className="text-[10px] text-text-secondary/60 bg-surface-lighter px-1.5 py-0.5 rounded">
                          纯音乐
                        </span>
                      )}
                      <span className="text-xs text-text-secondary/50">
                        {formatDate(task.submitTime)}
                      </span>
                    </div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(task.taskId)}
                    className="p-1.5 text-text-secondary/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* Error message */}
                {task.status === "Failure" && task.errorMessage && (
                  <p className="mt-2 text-xs text-red-400/80 pl-13">
                    {task.errorMessage}
                  </p>
                )}

                {/* Audio players */}
                {task.urls.length > 0 && (
                  <div className="mt-3 space-y-2 pl-13">
                    {task.urls.map((url, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3"
                      >
                        <button
                          onClick={() =>
                            setPlayingUrl(
                              playingUrl === url ? null : url,
                            )
                          }
                          className="w-8 h-8 rounded-full bg-primary/15 text-primary hover:bg-primary/25 flex items-center justify-center transition-colors shrink-0"
                        >
                          <svg
                            className="w-3.5 h-3.5 ml-0.5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>
                        <audio
                          controls
                          className="flex-1 h-8"
                          src={url}
                          onPlay={handleAudioPlay}
                          onEnded={handleAudioEnded}
                        >
                          <track kind="captions" />
                        </audio>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary-light hover:underline shrink-0"
                        >
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                {/* Loading indicator for pending tasks */}
                {(task.status === "Pending" || task.status === "Running") && (
                  <div className="mt-3 flex items-center gap-2 pl-13">
                    <svg
                      className="animate-spin w-3.5 h-3.5 text-accent-orange"
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
                    <span className="text-xs text-text-secondary">
                      正在生成，请稍候...
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
