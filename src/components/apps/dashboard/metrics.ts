import type { DiskInfo } from "@/types/api";

/**
 * 使用率百分比。
 *
 * ⚠️ `total` 是 0 或缺值時回 0 而不是 `NaN`。Dashboard 原本有三個同型的計算，
 * swap 與磁碟都防了除以零，只有**記憶體**沒有 —— 而記憶體那個算了兩次，
 * 其中一份會餵給折線圖。`total_memory` 真的是 0 的時候（容器限制了 /proc、
 * sysinfo 讀不到）畫面上會出現 `NaN%`，進度條的寬度也會變成 `NaN%`。
 */
export function usagePercent(used: number | null | undefined, total: number | null | undefined) {
  if (used === null || used === undefined) return 0;
  if (total === null || total === undefined || total <= 0) return 0;
  return (used / total) * 100;
}

export interface DiskTotals {
  readonly used: number;
  readonly size: number;
  readonly percent: number;
}

/** 所有磁碟加總。`used` 是 `total - available`，不是某個回傳欄位。 */
export function diskTotals(disks: readonly DiskInfo[] | undefined): DiskTotals {
  const list = disks ?? [];
  const size = list.reduce((acc, d) => acc + d.total_space, 0);
  const used = list.reduce((acc, d) => acc + (d.total_space - d.available_space), 0);
  return { used, size, percent: usagePercent(used, size) };
}

/**
 * 進度條的顏色。
 *
 * 門檻用 `>` 而不是 `>=`：剛好 90% 還不算「危險」。這條有測試是因為
 * 邊界值是唯一會出錯的地方。
 */
export function progressColor(percent: number): string {
  if (percent > 90) return "from-red-500 to-rose-600";
  if (percent > 75) return "from-amber-400 to-orange-500";
  return "from-emerald-400 to-teal-500";
}

/**
 * 磁碟在畫面上的名字。掛在 `/` 的顯示成 System，其餘取掛載點的最後一段。
 */
export function diskDisplayName(disk: { name: string; mount_point: string; disk_type: string }) {
  if (disk.mount_point === "/") return { name: "System", subtitle: disk.disk_type };
  const parts = disk.mount_point.split("/").filter(Boolean);
  return { name: parts.at(-1) ?? disk.name, subtitle: disk.disk_type };
}
