import { getApiErrorStatus } from "@/lib/errors";

/**
 * Docker 面板現在該顯示什麼。
 *
 * ⚠️ 原本只有 `isLoading ? "Loading…" : <清單>`，於是三種**完全不同**的狀況
 * 長得一模一樣，都是一片空白：
 *
 *   1. 使用者不在 `DOCKER_MANAGER_USER_IDS` 裡 → 403
 *   2. Docker daemon 連不上 → 503／connected: false
 *   3. 真的沒有容器
 *
 * production 的 `DOCKER_MANAGER_USER_IDS=1,2`，所以第三個帳號打開 Docker
 * 看到的就是永遠空白 —— 而且每 3 秒再打一次 403。
 */
export type DockerPaneState =
  | { readonly kind: "loading" }
  /** 403 —— 這個帳號沒有 Docker 管理權限 */
  | { readonly kind: "forbidden" }
  /** Docker daemon 連不上（或這台機器沒開 Docker 管理） */
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly status: number | undefined }
  | { readonly kind: "empty" }
  | { readonly kind: "ready" };

export function dockerPaneState(input: {
  isLoading: boolean;
  error: unknown;
  /** `useDockerStatus` 回的 `connected`，還沒問到就是 undefined */
  connected: boolean | undefined;
  itemCount: number;
}): DockerPaneState {
  const { isLoading, error, connected, itemCount } = input;

  // ⚠️ 錯誤要排在 loading 前面。react-query 重試時 isLoading 會再度為真，
  // 那時候顯示「Loading…」等於把已經知道的失敗蓋掉。
  if (error !== null && error !== undefined) {
    const status = getApiErrorStatus(error);
    if (status === 403) return { kind: "forbidden" };
    if (status === 503) return { kind: "unavailable" };
    return { kind: "error", status };
  }

  if (isLoading) return { kind: "loading" };

  // 沒有錯誤但 daemon 說沒連上 —— 清單會是空的，但原因不是「沒有容器」。
  if (connected === false) return { kind: "unavailable" };

  return itemCount === 0 ? { kind: "empty" } : { kind: "ready" };
}
