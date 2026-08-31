/**
 * 桌面圖示的網格座標。
 *
 * 抽成純函式的理由跟 `finder/marquee.ts` 一樣：這是純幾何，而它埋在拖曳的
 * mouseup handler 裡既測不到也看不出邊界。
 *
 * ⚠️ 常數要跟 `DraggableDesktopIcon` 的 CSS／版面對得起來。對不上的話沒有
 * 任何錯誤，只是拖放的落點跟游標差一格。
 */

export interface IconPosition {
  readonly row: number;
  readonly col: number;
}

/** 每格的邊長（與圖示寬度相同）。 */
export const GRID_SIZE = 100;
/** 格與格之間的間距。 */
export const GRID_GAP = 8;
/** 桌面四周的留白。 */
export const DESKTOP_PADDING = 16;
/** 頂端狀態列高度 —— 圖示區從它底下開始。 */
export const TOP_BAR_HEIGHT = 48;

/**
 * 尚未被拖曳過的圖示的預設位置。
 *
 * ⚠️ 排列方向是**先往下、再往右**（跟 macOS 桌面一致），不是先往右。
 * 改成 `index % perColumn` 與 `Math.floor` 對調就會變成先往右，
 * 而那不會有任何錯誤，只是圖示順序整個轉置。
 */
export function defaultIconPosition(index: number, iconsPerColumn = 8): IconPosition {
  if (iconsPerColumn <= 0) {
    throw new RangeError(`iconsPerColumn 必須是正數，收到 ${iconsPerColumn}`);
  }
  return { col: Math.floor(index / iconsPerColumn), row: index % iconsPerColumn };
}

/** 網格座標 → 畫面上的像素位置。 */
export function gridToPixels(position: IconPosition): { x: number; y: number } {
  return {
    x: position.col * (GRID_SIZE + GRID_GAP),
    y: position.row * (GRID_SIZE + GRID_GAP),
  };
}

/**
 * 放開滑鼠時的落點 → 最近的格子。
 *
 * ⚠️ 一定要夾在 0 以上。游標拖到頂端狀態列上方或桌面左緣外時算出來會是負的，
 * 而負的 row/col 會讓圖示跑到畫面外再也點不到 —— 而且那個位置會被存進
 * localStorage，重新整理也回不來。
 */
export function snapToGrid(clientX: number, clientY: number): IconPosition {
  const relativeX = clientX - DESKTOP_PADDING;
  const relativeY = clientY - TOP_BAR_HEIGHT - DESKTOP_PADDING;
  return {
    col: Math.max(0, Math.round(relativeX / (GRID_SIZE + GRID_GAP))),
    row: Math.max(0, Math.round(relativeY / (GRID_SIZE + GRID_GAP))),
  };
}

/** 一格的間距（含格線）—— 拖曳一步、鍵盤一步都是這個距離。 */
export const GRID_STEP = GRID_SIZE + GRID_GAP;

/**
 * 拖曳結束時的落點：**原位置 + 位移**，而不是游標所在的格子。
 *
 * ⚠️ 這是修掉的一個 bug。原本手刻的版本在 mouseup 時直接
 * `snapToGrid(e.clientX, e.clientY)` —— 用的是**游標**位置。抓著圖示的左上角
 * 拖沒問題，但抓右下角拖的話，落點會比圖示實際看到的位置偏移將近一格，
 * 放手瞬間圖示自己跳走。用位移就沒有這個問題：圖示落在它看起來該在的地方，
 * 跟抓在哪裡無關。
 */
export function movePositionBy(
  position: IconPosition,
  delta: { readonly x: number; readonly y: number },
): IconPosition {
  const { x, y } = gridToPixels(position);
  return {
    col: Math.max(0, Math.round((x + delta.x) / GRID_STEP)),
    row: Math.max(0, Math.round((y + delta.y) / GRID_STEP)),
  };
}
