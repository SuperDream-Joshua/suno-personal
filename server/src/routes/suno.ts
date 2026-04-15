import { Router } from "express";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { submitTask, queryTaskStatus } from "../services/suno-api.js";
import { parseFile } from "music-metadata";
import {
  createTask,
  updateTaskStatus,
  listTasks,
  getTaskInput,
} from "../services/task-store.js";
import {
  enqueueDownload,
  finishDownload,
  getDownloadStatus,
} from "../services/download-manager.js";

const router = Router();

const MUSIC_DIR = "/data/suno/music";
const TASKS_DIR = "/data/suno/tasks";

/**
 * 从请求头获取 Authorization，前端透传过来
 */
function getAuth(req: Request): string {
  return req.headers.authorization ?? "";
}

// ============================================
// POST /api/v1/tasks/submit
// ============================================
router.post("/v1/tasks/submit", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth) {
      res.status(401).json({ error: "缺少 Authorization header" });
      return;
    }

    const result = await submitTask(req.body, auth);

    // 上游返回非 2xx，直接透传
    if (result.status < 200 || result.status >= 300) {
      res.status(result.status).json(result.body);
      return;
    }

    // 解析 taskId 并创建本地文件，保存 submit 的请求参数
    const body = result.body as { output?: { task_id?: string } };
    const taskId = body?.output?.task_id;
    if (taskId) {
      await createTask(taskId, req.body).catch((err) => {
        console.error("[suno-route] 创建 task 文件失败:", err);
      });
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[suno-route] submit 错误:", err);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// ============================================
// GET /api/v1/tasks/status
// ============================================
router.get("/v1/tasks/status", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth) {
      res.status(401).json({ error: "缺少 Authorization header" });
      return;
    }

    const taskId = req.query.task_id as string;
    if (!taskId) {
      res.status(400).json({ error: "缺少 task_id 参数" });
      return;
    }

    const result = await queryTaskStatus(taskId, auth);

    // 上游返回非 2xx，直接透传
    if (result.status < 200 || result.status >= 300) {
      res.status(result.status).json(result.body);
      return;
    }

    // 解析状态并更新本地文件
    const body = result.body as {
      output?: {
        task_status?: string;
        error_message?: string;
      };
    };
    const status = body?.output?.task_status;

    if (status && taskId) {
      let resultData: Record<string, unknown> | undefined;

      if (status === "Success") {
        // 成功：保存完整返回体
        resultData = result.body as Record<string, unknown>;

        // 将音乐下载任务加入队列（异步，不阻塞响应）
        const output = (result.body as any)?.output;
        const urls = output?.urls as string[] | undefined;
        if (urls && urls.length > 0) {
          const input = await getTaskInput(taskId);
          enqueueDownload(taskId, urls, input);
        }
      } else if (status === "Failure") {
        // 失败：保存错误信息
        resultData = {
          error_message: body?.output?.error_message ?? "Unknown error",
        };
      }

      await updateTaskStatus(taskId, status, resultData).catch((err) => {
        console.error("[suno-route] 更新 task 文件失败:", err);
      });
    }

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[suno-route] status 错误:", err);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// ============================================
// GET /api/v1/tasks/list
// ============================================
router.get("/v1/tasks/list", async (_req: Request, res: Response) => {
  try {
    const tasks = await listTasks();
    res.json({ tasks });
  } catch (err) {
    console.error("[suno-route] listTasks 错误:", err);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// ============================================
// POST /api/v1/tasks/finishDownload
// ============================================
router.post("/v1/tasks/finishDownload", async (_req: Request, res: Response) => {
  try {
    const result = await finishDownload();
    const status = getDownloadStatus();
    res.json({
      ...result,
      downloadStatus: status,
    });
  } catch (err) {
    console.error("[suno-route] finishDownload 错误:", err);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// ============================================
// GET /api/v1/history
// ============================================

/** UUID 正则 */
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

interface HistoryTrack {
  index: number;
  fileName: string;
  url: string;
  size: number;
  duration: number | null;
}

interface HistoryItem {
  taskId: string;
  title: string;
  mode: string;
  instrumental: boolean;
  tags: string;
  createdAt: string;
  input: Record<string, any>;
  tracks: HistoryTrack[];
}

router.get("/v1/history", async (_req: Request, res: Response) => {
  try {
    // 1. 读取所有 .mp3 文件（排除 .downloading）
    const allFiles = await fs.readdir(MUSIC_DIR);
    const mp3Files = allFiles.filter(
      (f) => f.endsWith(".mp3") && !f.endsWith(".downloading"),
    );

    // 2. 按 taskId 分组
    const grouped = new Map<
      string,
      { fileName: string; index: number }[]
    >();

    for (const fileName of mp3Files) {
      const base = fileName.replace(/\.mp3$/, "");
      const match = base.match(UUID_RE);
      if (!match) continue;
      const taskId = match[1]!;

      // 提取 index：文件名末尾的 -N（1-based）
      const idxMatch = base.match(/-(\d+)$/);
      const index = idxMatch ? parseInt(idxMatch[1]!, 10) : 1;

      if (!grouped.has(taskId)) {
        grouped.set(taskId, []);
      }
      grouped.get(taskId)!.push({ fileName, index });
    }

    // 3. 构建 history 列表
    const history: HistoryItem[] = [];

    for (const [taskId, files] of grouped) {
      // 排序 track by index
      files.sort((a, b) => a.index - b.index);

      // 读取 task 文件获取 input 信息
      let input: Record<string, any> = {};
      try {
        const taskFilePath = path.join(TASKS_DIR, `${taskId}.success`);
        const raw = await fs.readFile(taskFilePath, "utf-8");
        const taskData = JSON.parse(raw);
        input = taskData.input ?? {};
      } catch {
        // task 文件不存在或解析失败，使用默认值
      }

      // 提取 title
      let title = "";
      const params = input.parameters as Record<string, any> | undefined;
      if (params?.title && typeof params.title === "string" && params.title.trim()) {
        title = params.title.trim();
      } else {
        const inp = input.input as Record<string, any> | undefined;
        if (
          inp?.gpt_description_prompt &&
          typeof inp.gpt_description_prompt === "string"
        ) {
          title = inp.gpt_description_prompt.trim().slice(0, 30);
        }
      }

      // 提取 mode
      const metadata = input.metadata as Record<string, any> | undefined;
      const mode = metadata?.create_mode ?? "inspiration";

      // 提取 instrumental
      const instrumental = params?.make_instrumental === true;

      // 提取 tags
      const tags = (params?.tags as string) ?? "";

      // 构建 tracks，获取文件大小和创建时间
      const tracks: HistoryTrack[] = [];
      let earliestBirthtime: Date | null = null;

      for (const file of files) {
        const filePath = path.join(MUSIC_DIR, file.fileName);
        try {
          const stat = await fs.stat(filePath);
          // 解析音频时长
          let duration: number | null = null;
          try {
            const meta = await parseFile(filePath, { duration: true });
            duration = meta.format.duration ?? null;
          } catch {
            // 解析失败，duration 保持 null
          }
          tracks.push({
            index: file.index,
            fileName: file.fileName,
            url: `/music/${file.fileName}`,
            size: stat.size,
            duration,
          });
          if (!earliestBirthtime || stat.birthtime < earliestBirthtime) {
            earliestBirthtime = stat.birthtime;
          }
        } catch {
          // 文件 stat 失败，跳过
        }
      }

      if (tracks.length === 0) continue;

      history.push({
        taskId,
        title,
        mode,
        instrumental,
        tags,
        createdAt: earliestBirthtime?.toISOString() ?? new Date().toISOString(),
        input,
        tracks,
      });
    }

    // 4. 按创建时间降序排序（最新在前）
    history.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    res.json({ history });
  } catch (err) {
    console.error("[suno-route] history 错误:", err);
    res.status(500).json({ error: "获取历史记录失败" });
  }
});

export default router;
