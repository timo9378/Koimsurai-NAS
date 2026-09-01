import type { FileInfo, TimelineGroup } from "@/types/api";

/** Virtuoso 的一列：日期標題，或一排照片。 */
export type TimelineRow =
  | { readonly type: "header"; readonly date: string; readonly count: number }
  | { readonly type: "row"; readonly items: FileInfo[] };

const PHOTOS_PER_ROW = 6;

/** 名稱包含關鍵字的才留下（大小寫不分）。空字串代表不過濾。 */
export function filterTimeline(timeline: readonly TimelineGroup[], query: string): TimelineGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...timeline];

  return (
    timeline
      .map((group) => ({
        ...group,
        files: group.files.filter((file) => file.name.toLowerCase().includes(needle)),
      }))
      // 整組被濾光就連日期標題一起拿掉 —— 不然會看到一堆空日期。
      .filter((group) => group.files.length > 0)
  );
}

/**
 * 把「依日期分組」攤平成 Virtuoso 要的一維列表。
 *
 * ⚠️ 欄位是 `files` 不是 `items`。Photos 原本在元件裡自己抄了一份
 * `interface TimelineGroup { items: MediaItem[] }`，跟後端送的
 * `{ date, files }` 對不上 —— 就算 URL 是對的，`group.items.length` 也會炸。
 * 這裡一律用產生出來的型別。
 */
export function flattenTimeline(
  timeline: readonly TimelineGroup[],
  perRow: number = PHOTOS_PER_ROW,
): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const group of timeline) {
    // 空的分組不產生標題 —— 過濾之後可能整組都沒了。
    if (group.files.length === 0) continue;

    rows.push({ type: "header", date: group.date, count: group.files.length });
    for (let i = 0; i < group.files.length; i += perRow) {
      rows.push({ type: "row", items: group.files.slice(i, i + perRow) });
    }
  }

  return rows;
}
