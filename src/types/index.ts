/** UCloud ModelVerse Suno API 类型定义 */

// ============================================
// 通用
// ============================================

/** 生成模式 */
export type GenerationMode = "inspiration" | "custom";

/** 模型版本 */
export type SunoModel =
  | "suno-v4"
  | "suno-v4.5"
  | "suno-v4.5+"
  | "suno-v5";

/** 任务状态 (UCloud ModelVerse) */
export type TaskStatus = "Pending" | "Running" | "Success" | "Failure";

/** 人声性别 */
export type VocalGender = "m" | "f";

/** 请求 metadata（固定字段 + 可配置 vocal_gender） */
export interface SubmitMetadata {
  web_client_pathname: string;
  is_max_mode: boolean;
  create_mode: string;
  disable_volume_normalization: boolean;
  vocal_gender: VocalGender;
}

// ============================================
// 提交任务 — 请求体
// ============================================

/** 灵感模式请求 */
export interface InspirationSubmitBody {
  model: SunoModel;
  input: {
    gpt_description_prompt: string;
  };
  parameters?: {
    make_instrumental?: boolean;
  };
  metadata: SubmitMetadata;
}

/** 自定义模式请求 */
export interface CustomSubmitBody {
  model: SunoModel;
  input: {
    prompt: string;
  };
  parameters?: {
    tags?: string;
    title?: string;
    make_instrumental?: boolean;
  };
  metadata: SubmitMetadata;
}

export type SubmitBody = InspirationSubmitBody | CustomSubmitBody;

// ============================================
// 提交任务 — 响应
// ============================================

export interface SubmitResponse {
  output: {
    task_id: string;
  };
  request_id: string;
}

// ============================================
// 查询任务状态 — 响应
// ============================================

export interface TaskStatusResponse {
  output: {
    task_id: string;
    task_status: TaskStatus;
    urls?: string[];
    submit_time?: number;
    finish_time?: number;
    error_message?: string;
  };
  usage?: Record<string, unknown>;
  request_id: string;
}

// ============================================
// 前端表单 state
// ============================================

export interface InspirationFormState {
  mode: "inspiration";
  description: string;
  instrumental: boolean;
}

export interface CustomFormState {
  mode: "custom";
  title: string;
  lyrics: string;
  tags: string;
  instrumental: boolean;
}

export type CreateFormState = InspirationFormState | CustomFormState;

// ============================================
// 本地任务记录 (localStorage 持久化)
// ============================================

export interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  mode: GenerationMode;
  title: string;
  description: string;
  tags: string;
  instrumental: boolean;
  urls: string[];
  submitTime: number;
  finishTime?: number;
  errorMessage?: string;
}

// ============================================
// MV 生成 (Vidu MV API)
// ============================================

/** MV 画面比例 */
export type MVAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

/** MV 分辨率 */
export type MVResolution = "540p" | "720p" | "1080p";

/** MV 字幕语言 */
export type MVLanguage = "zh" | "en";

/** MV 生成请求体 */
export interface MVSubmitBody {
  model: "vidu-mv";
  input: {
    images: string[];
    audio_url: string;
    prompt?: string;
  };
  parameters: {
    vidu_type: "one-click/mv";
    aspect_ratio?: MVAspectRatio;
    resolution?: MVResolution;
    add_subtitle?: boolean;
    language?: MVLanguage;
    srt_url?: string;
  };
}

/** MV 任务记录 (localStorage 持久化) */
export interface MVTaskRecord {
  taskId: string;
  status: TaskStatus;
  title: string;
  prompt: string;
  imageCount: number;
  urls: string[];
  submitTime: number;
  finishTime?: number;
  errorMessage?: string;
}

// ============================================
// 历史记录 (后端 API)
// ============================================

export interface HistoryTrack {
  index: number;
  fileName: string;
  url: string;
  size: number;
  duration: number | null;
}

export interface HistoryItem {
  taskId: string;
  title: string;
  mode: GenerationMode;
  instrumental: boolean;
  tags: string;
  createdAt: string;
  input: Record<string, unknown>;
  tracks: HistoryTrack[];
}

export interface HistoryResponse {
  history: HistoryItem[];
}
