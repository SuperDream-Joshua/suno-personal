import { useState, useCallback } from "react";
import type {
  GenerationMode,
  VocalGender,
  SunoModel,
  SubmitMetadata,
  InspirationSubmitBody,
  CustomSubmitBody,
  TaskRecord,
} from "@/types";
import {
  getApiKey,
  submitTask,
  pollTaskUntilDone,
} from "@/services/api";
import { addTask, updateTask } from "@/services/store";

const MODE_TABS: { value: GenerationMode; label: string }[] = [
  { value: "inspiration", label: "灵感模式" },
  { value: "custom", label: "自定义模式" },
];

/** 单次生成的结果 */
interface GenerationResult {
  taskId: string;
  title: string;
  mode: GenerationMode;
  urls: string[];
  status: "pending" | "done" | "error";
  error?: string;
}

export default function CreatePage() {
  const [mode, setMode] = useState<GenerationMode>("inspiration");

  // 灵感模式 state — 切换 tab 不清空
  const [inspDesc, setInspDesc] = useState("");
  const [inspInstrumental, setInspInstrumental] = useState(false);

  // 自定义模式 state — 切换 tab 不清空
  const [customTitle, setCustomTitle] = useState("");
  const [customLyrics, setCustomLyrics] = useState("");
  const [customTags, setCustomTags] = useState("");
  const [customInstrumental, setCustomInstrumental] = useState(false);

  // 通用设置
  const [model, setModel] = useState<SunoModel>("suno-v5");
  const [vocalGender, setVocalGender] = useState<VocalGender>("m");

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");

  // 当前会话的所有生成结果（右侧面板）
  const [results, setResults] = useState<GenerationResult[]>([]);

  const updateResult = useCallback(
    (taskId: string, patch: Partial<GenerationResult>) => {
      setResults((prev) =>
        prev.map((r) => (r.taskId === taskId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

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

  async function handleGenerate() {
    // 校验 API Key
    const apiKey = getApiKey();
    if (!apiKey) {
      setError("请先在左侧「API 设置」中配置你的 API Key");
      return;
    }

    // 校验输入
    if (mode === "inspiration" && !inspDesc.trim()) {
      setError("请输入音乐描述");
      return;
    }
    if (mode === "custom" && !customLyrics.trim() && !customInstrumental) {
      setError("请输入歌词，或选择纯音乐模式");
      return;
    }

    setError("");
    setIsGenerating(true);
    setStatusText("提交任务中...");

    try {
      // 构建请求体
      let body: InspirationSubmitBody | CustomSubmitBody;
      let title: string;

      const metadata: SubmitMetadata = {
        web_client_pathname: "/create",
        is_max_mode: false,
        create_mode: mode === "custom" ? "custom" : "inspiration",
        disable_volume_normalization: false,
        vocal_gender: vocalGender,
      };

      if (mode === "inspiration") {
        body = {
          model,
          input: {
            gpt_description_prompt: inspDesc.trim(),
          },
          ...(inspInstrumental
            ? { parameters: { make_instrumental: true } }
            : {}),
          metadata,
        } satisfies InspirationSubmitBody;
        title = inspDesc.trim().slice(0, 30) || "未命名";
      } else {
        body = {
          model,
          input: {
            prompt: customLyrics.trim(),
          },
          parameters: {
            ...(customTitle.trim() ? { title: customTitle.trim() } : {}),
            ...(customTags.trim() ? { tags: customTags.trim() } : {}),
            ...(customInstrumental ? { make_instrumental: true } : {}),
          },
          metadata,
        } satisfies CustomSubmitBody;
        title = customTitle.trim() || "未命名";
      }

      // 提交
      const submitRes = await submitTask(body);
      const taskId = submitRes.output.task_id;

      // 保存到本地历史记录
      const record: TaskRecord = {
        taskId,
        status: "Pending",
        mode,
        title,
        description:
          mode === "inspiration"
            ? inspDesc.trim()
            : customLyrics.trim().slice(0, 100),
        tags: mode === "custom" ? customTags.trim() : "",
        instrumental:
          mode === "inspiration" ? inspInstrumental : customInstrumental,
        urls: [],
        submitTime: Date.now(),
      };
      addTask(record);

      // 添加到右侧结果面板
      const newResult: GenerationResult = {
        taskId,
        title,
        mode,
        urls: [],
        status: "pending",
      };
      setResults((prev) => [newResult, ...prev]);

      setStatusText("任务已提交，生成中...");

      // 轮询
      const finalResult = await pollTaskUntilDone(taskId, (res) => {
        const s = res.output.task_status;
        if (s === "Running") {
          setStatusText("AI 正在创作你的音乐...");
        }
        // 实时更新本地历史
        updateTask(taskId, {
          status: s,
          urls: res.output.urls ?? [],
          finishTime: res.output.finish_time,
          errorMessage: res.output.error_message,
        });
        // 如果已经有部分 URL，实时更新右侧面板
        if (res.output.urls && res.output.urls.length > 0) {
          updateResult(taskId, { urls: res.output.urls });
        }
      });

      const urls = finalResult.output.urls ?? [];
      updateResult(taskId, { urls, status: "done" });
      setStatusText("");

      // 最终更新历史记录
      updateTask(taskId, {
        status: "Success",
        urls,
        finishTime: finalResult.output.finish_time,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setError(msg);
      setStatusText("");
      // 标记最新结果为失败
      setResults((prev) => {
        if (prev.length === 0) return prev;
        const [first, ...rest] = prev;
        if (first && first.status === "pending") {
          return [{ ...first, status: "error" as const, error: msg }, ...rest];
        }
        return prev;
      });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* ===== 左侧：输入区 ===== */}
      <div className="w-[420px] shrink-0 border-r border-border overflow-y-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold">创作</h2>
          <p className="text-text-secondary text-sm mt-1">
            选择你的创作方式，让 AI 为你生成音乐
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-1 p-1 bg-surface-light rounded-lg mb-6">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setMode(tab.value);
                setError("");
              }}
              disabled={isGenerating}
              className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-all ${
                mode === tab.value
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ===== 灵感模式 ===== */}
        <div className={mode === "inspiration" ? "space-y-5" : "hidden"}>
          <div>
            <label className="block text-sm font-medium mb-2">
              描述你想要的音乐
            </label>
            <textarea
              value={inspDesc}
              onChange={(e) => setInspDesc(e.target.value)}
              placeholder="例如：一首关于乡愁的歌，带有轻快的吉他和温暖的人声..."
              rows={4}
              maxLength={500}
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-sm text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/50 resize-none transition-colors disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary/50 mt-1 text-right">
              {inspDesc.length}/500
            </p>
          </div>

          <Checkbox
            checked={inspInstrumental}
            onChange={setInspInstrumental}
            disabled={isGenerating}
            label="纯音乐（无人声）"
          />
        </div>

        {/* ===== 自定义模式 ===== */}
        <div className={mode === "custom" ? "space-y-5" : "hidden"}>
          <div>
            <label className="block text-sm font-medium mb-2">歌曲标题</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="为你的歌曲取个名字"
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-sm text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              风格标签
              <span className="text-text-secondary/50 font-normal ml-1">
                (tags)
              </span>
            </label>
            <input
              type="text"
              value={customTags}
              onChange={(e) => setCustomTags(e.target.value)}
              placeholder="例如：pop, ballad, rock, lo-fi..."
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-sm text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">歌词</label>
            <textarea
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value)}
              placeholder={"[Verse]\n在这里写下你的歌词...\n\n[Chorus]\n副歌部分..."}
              rows={8}
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-surface-light border border-border rounded-xl text-sm text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/50 resize-none transition-colors font-mono disabled:opacity-50"
            />
            <p className="text-[11px] text-text-secondary/50 mt-1">
              纯音乐模式下歌词可留空
            </p>
          </div>

          <Checkbox
            checked={customInstrumental}
            onChange={setCustomInstrumental}
            disabled={isGenerating}
            label="纯音乐（无人声）"
          />
        </div>



        {/* 模型版本 */}
        <div className="mt-5">
          <label className="block text-sm font-medium mb-2">模型版本</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "suno-v4" as SunoModel, label: "V4" },
              { value: "suno-v4.5" as SunoModel, label: "V4.5" },
              { value: "suno-v4.5+" as SunoModel, label: "V4.5+" },
              { value: "suno-v5" as SunoModel, label: "V5" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setModel(opt.value)}
                disabled={isGenerating}
                className={`py-2 text-sm rounded-lg border transition-all ${
                  model === opt.value
                    ? "bg-primary/15 text-primary-light border-primary/30"
                    : "bg-surface-light border-border text-text-secondary hover:text-text"
                } disabled:opacity-50`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* 人声性别 */}
        <div className="mt-5">
          <label className="block text-sm font-medium mb-2">人声性别</label>
          <div className="flex gap-2">
            {([
              { value: "m" as VocalGender, label: "男声" },
              { value: "f" as VocalGender, label: "女声" },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setVocalGender(opt.value)}
                disabled={isGenerating}
                className={`flex-1 py-2 text-sm rounded-lg border transition-all ${
                  vocalGender === opt.value
                    ? "bg-primary/15 text-primary-light border-primary/30"
                    : "bg-surface-light border-border text-text-secondary hover:text-text"
                } disabled:opacity-50`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* Error */}
        {error && (
          <div className="mt-5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Status */}
        {statusText && !error && (
          <div className="mt-5 px-4 py-3 bg-primary/10 border border-primary/20 rounded-xl text-sm text-primary-light flex items-center gap-2">
            {isGenerating && <Spinner />}
            {statusText}
          </div>
        )}

        {/* 生成按钮 */}
        <div className="mt-6">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-3.5 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors text-sm"
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                生成中...
              </span>
            ) : (
              "✨ 开始创作"
            )}
          </button>
        </div>
      </div>

      {/* ===== 右侧：生成结果 ===== */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">生成结果</h3>
            <p className="text-text-secondary text-xs mt-0.5">
              本次会话的所有创作
            </p>
          </div>
          {results.length > 0 && (
            <button
              onClick={() => setResults([])}
              className="px-3 py-1.5 text-xs text-text-secondary bg-surface-light border border-border rounded-lg hover:text-text transition-colors"
            >
              清空
            </button>
          )}
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[calc(100%-80px)] text-center">
            <p className="text-4xl mb-3 opacity-40">🎶</p>
            <p className="text-sm text-text-secondary/60">
              生成的音乐将在这里展示
            </p>
            <p className="text-xs text-text-secondary/40 mt-1">
              在左侧输入参数后点击「开始创作」
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {results.map((r) => (
              <div
                key={r.taskId}
                className="p-4 bg-surface-light border border-border rounded-xl"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="text-sm font-medium truncate flex-1">
                    {r.title}
                  </h4>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-lighter text-text-secondary shrink-0">
                    {r.mode === "inspiration" ? "灵感" : "自定义"}
                  </span>
                  {r.status === "pending" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-orange/15 text-accent-orange shrink-0 flex items-center gap-1">
                      <Spinner size={10} />
                      生成中
                    </span>
                  )}
                  {r.status === "done" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-green/15 text-accent-green shrink-0">
                      已完成
                    </span>
                  )}
                  {r.status === "error" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 shrink-0">
                      失败
                    </span>
                  )}
                </div>

                {/* Error */}
                {r.status === "error" && r.error && (
                  <p className="text-xs text-red-400/80 mb-3">{r.error}</p>
                )}

                {/* Loading */}
                {r.status === "pending" && r.urls.length === 0 && (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <Spinner />
                    <span className="text-xs text-text-secondary">
                      AI 正在创作...
                    </span>
                  </div>
                )}

                {/* Audio tracks */}
                {r.urls.length > 0 && (
                  <div className="space-y-3">
                    {r.urls.map((url, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-secondary">
                            Track {i + 1}
                          </span>
                          <div className="flex-1 h-px bg-border" />
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-primary-light hover:underline"
                          >
                            下载 MP3
                          </a>
                        </div>
                        <audio
                          controls
                          className="w-full h-10"
                          src={url}
                          onPlay={handleAudioPlay}
                          onEnded={handleAudioEnded}
                        >
                          <track kind="captions" />
                        </audio>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// 子组件
// ============================================

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin shrink-0"
      width={size}
      height={size}
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
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 cursor-pointer group ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
          disabled={disabled}
        />
        <div className="w-5 h-5 rounded-md border-2 border-border bg-surface-light peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
          {checked && (
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </div>
      </div>
      <span className="text-sm text-text-secondary group-hover:text-text transition-colors">
        {label}
      </span>
    </label>
  );
}
