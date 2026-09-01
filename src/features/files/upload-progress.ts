import type { UploadTask } from "@/store/upload-store";

/**
 * 多個上傳合起來的進度百分比。
 *
 * ⚠️ 要用**位元組**加權，不能把每個任務的百分比平均。同時傳一個 4GB 的影片
 * 跟一個 2KB 的截圖時，平均法會在截圖傳完的瞬間跳到 50%，然後卡在那裡幾分鐘
 * —— 進度條說的話跟使用者看到的完全對不上。
 *
 * 大小為 0 的檔案（空檔）沒有權重，全部都是空檔時退回件數平均，
 * 否則會變成 0 除以 0。
 */
export function overallProgress(tasks: readonly UploadTask[]): number {
  if (tasks.length === 0) return 0;

  const totalBytes = tasks.reduce((sum, t) => sum + t.file.size, 0);
  if (totalBytes === 0) {
    return Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length);
  }

  const done = tasks.reduce((sum, t) => sum + (t.file.size * t.progress) / 100, 0);
  return Math.round((done / totalBytes) * 100);
}
