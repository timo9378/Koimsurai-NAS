/**
 * Finder 的框選（拖曳出一個矩形選取檔案）。
 *
 * 這裡是**純幾何**：不碰 DOM，只用版面參數推算每一項的邏輯位置。抽出來的
 * 理由跟 `history.ts` / `selection.ts` 一樣 —— 這段的正確性全在數字上，
 * 而數字埋在元件的 useCallback 裡既看不出來也測不到。
 *
 * ⚠️ 常數必須跟 FileList 的 CSS 對得起來：
 *   grid  `grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4 p-4`
 *   list  header 36px、每列 32px
 * CSS 改了這裡沒改的話，框選會選到錯的東西 —— 而且沒有任何錯誤，
 * 只是拖出來的框跟實際選到的檔案對不上。
 */

export interface MarqueeBox {
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
}

export const GRID_GAP = 16;
export const GRID_PADDING = 16;
const GRID_MIN_COL_WIDTH = 100;
/** icon 48 + 文字 ~20 + padding 16 */
export const GRID_CELL_HEIGHT = 84;
export const LIST_HEADER_HEIGHT = 36;
export const LIST_ROW_HEIGHT = 32;

/**
 * `repeat(auto-fill, minmax(100px, 1fr))` 在指定寬度下會排出幾欄。
 *
 * ⚠️ 至少回 1。容器還沒佈局完時 `clientWidth` 是 0，算出來會是 0 甚至負數，
 * 而 0 欄會讓下面的 `index % cols` 變成 NaN。
 */
export function gridColumns(containerWidth: number): number {
  const available = containerWidth - GRID_PADDING * 2;
  return Math.max(1, Math.floor((available + GRID_GAP) / (GRID_MIN_COL_WIDTH + GRID_GAP)));
}

/** 兩個區間有沒有重疊（含邊界相接）。 */
const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) =>
  !(aMin > bMax || aMax < bMin);

export type MarqueeLayout =
  | { readonly mode: "grid"; readonly containerWidth: number }
  | { readonly mode: "list" };

/**
 * 框選命中的項目索引。
 *
 * ⚠️ 容器寬度還是 0（尚未佈局）時回空陣列，而不是「全選」。算出來的
 * cell 寬會是負數，矩形判定就變得沒有意義 —— 使用者會看到剛開啟視窗、
 * 隨手一點就把整個資料夾選起來。
 */
export function itemsInMarquee(
  box: MarqueeBox,
  itemCount: number,
  layout: MarqueeLayout,
): number[] {
  if (itemCount <= 0) return [];

  const left = Math.min(box.startX, box.currentX);
  const right = Math.max(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const bottom = Math.max(box.startY, box.currentY);

  const hit: number[] = [];

  if (layout.mode === "list") {
    // ⚠️ list 模式**刻意只看 Y**：每一列是整行寬的，在右側空白處拖曳
    // 仍然應該選到那些列。
    for (let i = 0; i < itemCount; i++) {
      const itemTop = LIST_HEADER_HEIGHT + i * LIST_ROW_HEIGHT;
      if (overlaps(top, bottom, itemTop, itemTop + LIST_ROW_HEIGHT)) hit.push(i);
    }
    return hit;
  }

  const available = layout.containerWidth - GRID_PADDING * 2;
  if (available <= 0) return [];

  const cols = gridColumns(layout.containerWidth);
  const cellWidth = (available - GRID_GAP * (cols - 1)) / cols;
  if (cellWidth <= 0) return [];

  for (let i = 0; i < itemCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemLeft = GRID_PADDING + col * (cellWidth + GRID_GAP);
    const itemTop = GRID_PADDING + row * (GRID_CELL_HEIGHT + GRID_GAP);
    if (
      overlaps(left, right, itemLeft, itemLeft + cellWidth) &&
      overlaps(top, bottom, itemTop, itemTop + GRID_CELL_HEIGHT)
    ) {
      hit.push(i);
    }
  }
  return hit;
}
