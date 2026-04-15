const MODELVERSE_BASE = "https://api.modelverse.cn";

interface SubmitResult {
  status: number;
  body: unknown;
}

/**
 * 提交任务到 ModelVerse
 */
export async function submitTask(
  requestBody: unknown,
  authorization: string,
): Promise<SubmitResult> {
  const res = await fetch(`${MODELVERSE_BASE}/v1/tasks/submit`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const body = await res.json();
  return { status: res.status, body };
}

/**
 * 查询任务状态
 */
export async function queryTaskStatus(
  taskId: string,
  authorization: string,
): Promise<SubmitResult> {
  const res = await fetch(
    `${MODELVERSE_BASE}/v1/tasks/status?task_id=${taskId}`,
    {
      method: "GET",
      headers: {
        Authorization: authorization,
      },
    },
  );

  const body = await res.json();
  return { status: res.status, body };
}
