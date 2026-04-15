import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const SUNO_DATA_DIR = "/data/suno";
const TASKS_DIR = path.join(SUNO_DATA_DIR, "tasks");
const MUSIC_DIR = path.join(SUNO_DATA_DIR, "music");

const MAX_CONCURRENCY = 2;

/** 下载任务 */
interface DownloadJob {
  url: string;
  filePath: string;       // 最终文件路径 (.mp3)
  downloadingPath: string; // 下载中路径 (.mp3.downloading)
}

/** 队列 */
const queue: DownloadJob[] = [];
/** 正在下载的文件路径集合（downloadingPath） */
const activeJobs = new Set<string>();
/** 已入队的文件路径集合（防重复） */
const enqueuedPaths = new Set<string>();

/**
 * 添加下载任务到队列
 */
function enqueue(job: DownloadJob): boolean {
  // 已经在队列或正在下载中，跳过
  if (enqueuedPaths.has(job.downloadingPath) || activeJobs.has(job.downloadingPath)) {
    return false;
  }
  queue.push(job);
  enqueuedPaths.add(job.downloadingPath);
  drain(); // 尝试消费队列
  return true;
}

/**
 * 消费队列，维持最大并发数
 */
function drain(): void {
  while (activeJobs.size < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    enqueuedPaths.delete(job.downloadingPath);
    activeJobs.add(job.downloadingPath);
    executeDownload(job).finally(() => {
      activeJobs.delete(job.downloadingPath);
      drain(); // 完成后继续消费
    });
  }
}

/**
 * 执行单个下载
 */
async function executeDownload(job: DownloadJob): Promise<void> {
  try {
    console.log(`[download] 开始下载: ${path.basename(job.filePath)}`);
    const res = await fetch(job.url);
    if (!res.ok || !res.body) {
      console.error(`[download] 下载失败 (${res.status}): ${job.url}`);
      return;
    }

    const ws = createWriteStream(job.downloadingPath);
    // @ts-ignore - Node fetch body is a ReadableStream
    await pipeline(res.body, ws);

    // 下载完成，重命名
    await fs.rename(job.downloadingPath, job.filePath);
    console.log(`[download] 下载完成: ${path.basename(job.filePath)}`);
  } catch (err) {
    await fs.unlink(job.downloadingPath).catch(() => {});
    console.error(`[download] 下载出错: ${job.url}`, err);
  }
}

// ============================================
// 公开 API
// ============================================

/**
 * 清理文件名中的非法字符
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "_").trim() || "untitled";
}

/**
 * 从 input body 中提取歌曲名，仅取 parameters.title
 */
function extractTitle(input: Record<string, unknown>): string | null {
  const params = input.parameters as Record<string, unknown> | undefined;
  if (params?.title && typeof params.title === "string" && params.title.trim()) {
    return params.title.trim();
  }
  return null;
}

/**
 * 生成下载文件名
 */
function buildFileName(
  taskId: string,
  input: Record<string, unknown>,
  index: number,
  total: number,
): string {
  const title = extractTitle(input);
  const prefix = title ? `${sanitizeFileName(title)}-${taskId}` : taskId;
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `${prefix}${suffix}.mp3`;
}

/**
 * 将音乐下载任务加入队列
 * （替代原来的 downloadMusic，现在不直接下载，而是入队）
 */
export function enqueueDownload(
  taskId: string,
  urls: string[],
  input: Record<string, unknown>,
): void {
  for (let i = 0; i < urls.length; i++) {
    const fileName = buildFileName(taskId, input, i, urls.length);
    const filePath = path.join(MUSIC_DIR, fileName);
    const downloadingPath = `${filePath}.downloading`;

    // 如果最终文件已存在，跳过
    fs.access(filePath).then(() => {
      // 文件已存在，不用下
    }).catch(() => {
      enqueue({ url: urls[i]!, filePath, downloadingPath });
    });
  }
}

/**
 * 检查是否某个 downloadingPath 正在下载中
 */
export function isDownloading(downloadingPath: string): boolean {
  return activeJobs.has(downloadingPath) || enqueuedPaths.has(downloadingPath);
}

/**
 * finishDownload 逻辑：
 * 1. 扫描 /data/suno/music 中 .downloading 文件，如果不在下载队列中则重新入队
 * 2. 扫描 /data/suno/tasks 中 .success 的 task，检查音乐文件是否存在/正在下载，缺失则入队
 */
export async function finishDownload(): Promise<{
  requeued: string[];
  missing: string[];
}> {
  const requeued: string[] = [];
  const missing: string[] = [];

  // 1. 扫描 .downloading 文件
  const musicFiles = await fs.readdir(MUSIC_DIR).catch(() => [] as string[]);
  for (const file of musicFiles) {
    if (!file.endsWith(".downloading")) continue;

    const downloadingPath = path.join(MUSIC_DIR, file);

    // 如果已经在队列或正在下载，跳过
    if (isDownloading(downloadingPath)) continue;

    // 需要找到对应的 URL 来重新下载
    // 从文件名中提取 taskId
    const taskId = extractTaskIdFromFileName(file);
    if (!taskId) {
      // 无法识别，删除孤立的 downloading 文件
      await fs.unlink(downloadingPath).catch(() => {});
      continue;
    }

    // 从 task 文件中获取 URL
    const urlInfo = await getUrlsForTask(taskId);
    if (!urlInfo) continue;

    // 找到对应 index 的 URL
    const index = extractIndexFromFileName(file, urlInfo.urls.length);
    if (index !== null && urlInfo.urls[index]) {
      const filePath = downloadingPath.replace(/\.downloading$/, "");
      // 先删除不完整的文件
      await fs.unlink(downloadingPath).catch(() => {});
      enqueue({ url: urlInfo.urls[index]!, filePath, downloadingPath });
      requeued.push(file);
    }
  }

  // 2. 扫描 .success 的 task，补全缺失的下载
  const taskFiles = await fs.readdir(TASKS_DIR);
  const currentMusicFiles = await fs.readdir(MUSIC_DIR).catch(() => [] as string[]);

  for (const file of taskFiles) {
    if (!file.endsWith(".success")) continue;

    const taskId = file.replace(/\.success$/, "");
    const fullPath = path.join(TASKS_DIR, file);

    let data: { input: Record<string, unknown>; result: Record<string, unknown> | null };
    try {
      const raw = await fs.readFile(fullPath, "utf-8");
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    const output = data.result as any;
    const urls = output?.output?.urls as string[] | undefined;
    if (!urls || urls.length === 0) continue;

    for (let i = 0; i < urls.length; i++) {
      const fileName = buildFileName(taskId, data.input, i, urls.length);
      const filePath = path.join(MUSIC_DIR, fileName);
      const downloadingPath = `${filePath}.downloading`;

      // 检查文件是否已存在（完成的或正在下载的）
      const exists = currentMusicFiles.includes(fileName);
      const downloading = currentMusicFiles.includes(`${fileName}.downloading`);
      const inQueue = isDownloading(downloadingPath);

      if (!exists && !downloading && !inQueue) {
        enqueue({ url: urls[i]!, filePath, downloadingPath });
        missing.push(fileName);
      }
    }
  }

  return { requeued, missing };
}

/**
 * 从下载文件名中提取 taskId
 * 文件名格式：[title-]taskId[-index].mp3.downloading
 */
function extractTaskIdFromFileName(fileName: string): string | null {
  // 去掉 .mp3.downloading
  const base = fileName.replace(/\.mp3\.downloading$/, "");
  // taskId 是 UUID 格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = base.match(uuidRegex);
  return match ? match[1]! : null;
}

/**
 * 从文件名中提取 index（0-based）
 */
function extractIndexFromFileName(fileName: string, totalUrls: number): number | null {
  if (totalUrls <= 1) return 0;
  // 匹配末尾的 -N（N 是 1-based）
  const match = fileName.match(/-(\d+)\.mp3\.downloading$/);
  if (match) {
    const idx = parseInt(match[1]!, 10) - 1; // 转为 0-based
    return idx >= 0 && idx < totalUrls ? idx : null;
  }
  return 0;
}

/**
 * 从 task 文件中获取 urls
 */
async function getUrlsForTask(
  taskId: string,
): Promise<{ urls: string[]; input: Record<string, unknown> } | null> {
  const taskFiles = await fs.readdir(TASKS_DIR);
  const taskFile = taskFiles.find(
    (f) => f.startsWith(taskId) && f.endsWith(".success"),
  );
  if (!taskFile) return null;

  try {
    const raw = await fs.readFile(path.join(TASKS_DIR, taskFile), "utf-8");
    const data = JSON.parse(raw);
    const urls = data?.result?.output?.urls as string[] | undefined;
    return urls ? { urls, input: data.input ?? {} } : null;
  } catch {
    return null;
  }
}

/**
 * 获取下载队列状态
 */
export function getDownloadStatus(): {
  active: number;
  queued: number;
  activeFiles: string[];
  queuedFiles: string[];
} {
  return {
    active: activeJobs.size,
    queued: queue.length,
    activeFiles: [...activeJobs].map((p) => path.basename(p)),
    queuedFiles: queue.map((j) => path.basename(j.filePath)),
  };
}
