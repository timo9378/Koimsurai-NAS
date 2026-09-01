import { getApiErrorStatus } from "@/lib/errors";

/**
 * 輪詢間隔：正常時用 `normalMs`，出錯時放慢到 `slowMs`，403 則完全停止。
 *
 * ⚠️ 三種處置各有理由：
 * - **403 停止**：權限是伺服器環境變數決定的，不會在這個 session 裡自己好。
 *   production 的 `DOCKER_MANAGER_USER_IDS=1,2` 讓第三個帳號拿到 403，
 *   固定間隔的輪詢會讓它每 3 秒再打一次，永遠。
 * - **其他錯誤放慢而不是停止**：後端重啟、暫時的 500、網路抖動都會自己好。
 *   完全停掉的話畫面會一直卡在錯誤狀態 —— 尤其 `useSystemStatus` 還設了
 *   `refetchOnWindowFocus: false`，停了就真的沒有任何東西會再試。
 * - **正常時維持原本的節奏**：這些數字是各自調過的，不要一律拉平。
 */
export function backoffInterval(normalMs: number, slowMs = 30_000) {
  return (query: { state: { error: unknown } }): number | false => {
    const { error } = query.state;
    if (error === null || error === undefined) return normalMs;
    return getApiErrorStatus(error) === 403 ? false : slowMs;
  };
}
