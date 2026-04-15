import fs from "node:fs/promises";
import path from "node:path";

// /data/suno/
const SUNO_DATA_DIR = "/data/suno";
const TASKS_DIR = path.join(SUNO_DATA_DIR, "tasks");
const MUSIC_DIR = path.join(SUNO_DATA_DIR, "music");

const VALID_EXTENSIONS = ["idle", "pending", "running", "success", "failure"];

/** 文件内的 JSON 结构 */
interface TaskFileData {
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

/**
 * 启动时确保目录存在
 */
export async function ensureDataDirs(): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
  await fs.mkdir(MUSIC_DIR, { recursive: true });
  console.log(`[task-store] 数据目录就绪: ${TASKS_DIR}`);
  console.log(`[task-store] 音乐目录就绪: ${MUSIC_DIR}`);
}

/**
 * 创建 idle 状态的 task 文件，写入 submit 的请求参数
 */
export async function createTask(
  taskId: string,
  inputBody: Record<string, unknown>,
): Promise<void> {
  const filePath = path.join(TASKS_DIR, `${taskId}.idle`);
  const data: TaskFileData = {
    input: inputBody,
    result: null,
  };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[task-store] 创建任务文件: ${taskId}.idle`);
}

/**
 * 查找某个 taskId 当前的文件（不管扩展名是什么）
 */
async function findTaskFile(
  taskId: string,
): Promise<{ fullPath: string; ext: string } | null> {
  const files = await fs.readdir(TASKS_DIR);
  for (const file of files) {
    const dotIdx = file.indexOf(".");
    if (dotIdx === -1) continue;
    const name = file.slice(0, dotIdx);
    const ext = file.slice(dotIdx + 1);
    if (name === taskId && VALID_EXTENSIONS.includes(ext)) {
      return { fullPath: path.join(TASKS_DIR, file), ext };
    }
  }
  return null;
}

/**
 * 读取现有文件内容（解析 JSON）
 */
async function readTaskData(filePath: string): Promise<TaskFileData> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as TaskFileData;
  } catch {
    return { input: {}, result: null };
  }
}

/**
 * 更新 task 状态：重命名扩展名，保留 input，合并 result
 */
export async function updateTaskStatus(
  taskId: string,
  newStatus: string,
  resultData?: Record<string, unknown>,
): Promise<void> {
  const statusMap: Record<string, string> = {
    Pending: "pending",
    Running: "running",
    Success: "success",
    Failure: "failure",
  };

  const ext = statusMap[newStatus];
  if (!ext) {
    console.warn(`[task-store] 未知状态: ${newStatus}，跳过文件更新`);
    return;
  }

  const newPath = path.join(TASKS_DIR, `${taskId}.${ext}`);

  // 读取现有文件内容，保留 input
  const existing = await findTaskFile(taskId);
  let data: TaskFileData = { input: {}, result: null };

  if (existing) {
    data = await readTaskData(existing.fullPath);
    // 删除旧文件（如果路径不同）
    if (existing.fullPath !== newPath) {
      await fs.unlink(existing.fullPath).catch(() => {});
    }
  }

  // 写入 result（成功或失败时）
  if (resultData !== undefined) {
    data.result = resultData;
  }

  await fs.writeFile(newPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[task-store] 更新任务: ${taskId}.${ext}`);
}

/** list 返回的单条记录 */
export interface TaskListItem {
  taskId: string;
  input: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  localPaths?: string[];
  createdAt: string;
}

/**
 * 遍历所有任务文件，按文件创建时间降序返回
 */
export async function listTasks(): Promise<TaskListItem[]> {
  const [taskFiles, musicFiles] = await Promise.all([
    fs.readdir(TASKS_DIR),
    fs.readdir(MUSIC_DIR).catch(() => [] as string[]),
  ]);

  const items: TaskListItem[] = [];

  for (const file of taskFiles) {
    const dotIdx = file.indexOf(".");
    if (dotIdx === -1) continue;
    const taskId = file.slice(0, dotIdx);
    const ext = file.slice(dotIdx + 1);
    if (!VALID_EXTENSIONS.includes(ext)) continue;

    const fullPath = path.join(TASKS_DIR, file);
    const [stat, data] = await Promise.all([
      fs.stat(fullPath),
      readTaskData(fullPath),
    ]);

    const item: TaskListItem = {
      taskId,
      input: data.input,
      status: ext,
      result: data.result,
      createdAt: stat.birthtime.toISOString(),
    };

    // success 的任务查找本地音乐文件
    if (ext === "success") {
      const matched = musicFiles
        .filter((f) => f.includes(taskId) && f.endsWith(".mp3"))
        .map((f) => path.join(MUSIC_DIR, f));
      if (matched.length > 0) {
        item.localPaths = matched;
      }
    }

    items.push(item);
  }

  // 按创建时间降序
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return items;
}

/**
 * 读取某个 task 的 input 数据
 */
export async function getTaskInput(taskId: string): Promise<Record<string, unknown>> {
  const existing = await findTaskFile(taskId);
  if (!existing) return {};
  const data = await readTaskData(existing.fullPath);
  return data.input;
}
