export interface Bounds {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface Viewport {
  width: number;
  height: number;
}

/** 上方選單列的高度（TopBar 是 `h-8`）。視窗不該蓋住它，也不該躲在它後面。 */
export const TOP_BAR = 32;
/** 下方 Dock 佔掉的高度（`bottom-4` + `h-16`）。 */
export const DOCK = 80;
/** 左右留白，讓視窗邊框看得出來。 */
export const MARGIN = 8;

/** 跟 WindowContainer 的縮放下限一致 —— 夾限不可以夾出一個比手動縮放還小的視窗。 */
export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 300;

/**
 * 把一個視窗的位置與大小夾進看得見的範圍。
 *
 * 為什麼需要：`openWindow` 原本直接用寫死的預設值 —— preview 是 900×700，
 * 位置是 `y = 100 + 已開視窗數 × 20`。在 1280×720 的畫面上（筆電、或瀏覽器
 * 扣掉工具列之後），第二個視窗就是 `120 + 700 = 820 > 720`：**底部 100px
 * 直接在畫面外**。標題列在上面所以拖得動，但使用者看不到自己少了什麼，
 * 而視窗底部的東西（例如試算表的工作表分頁）根本點不到。
 *
 * 這是 E2E 撞出來的：Playwright 的
 * 「element is outside of the viewport」重試了 49 次。
 *
 * ⚠️ 先夾大小再夾位置。反過來的話，一個比畫面還大的視窗會先被推到
 * `y = TOP_BAR`，然後才被縮小 —— 結果是底部空一塊。
 */
export function fitToViewport(bounds: Bounds, viewport: Viewport): Bounds {
  const availableWidth = Math.max(MIN_WIDTH, viewport.width - MARGIN * 2);
  const availableHeight = Math.max(MIN_HEIGHT, viewport.height - TOP_BAR - DOCK);

  const width = Math.min(bounds.size.width, availableWidth);
  const height = Math.min(bounds.size.height, availableHeight);

  // ⚠️ maxX 有可能小於 MARGIN（畫面比 MIN_WIDTH 還窄，例如手機）。
  // 那時候 `Math.min(maxX, …)` 會贏過下限，視窗被推到負座標、標題列跑到畫面
  // 左外側 —— 連拖回來都做不到。所以下限要放在最後。
  const maxX = viewport.width - width - MARGIN;
  const maxY = viewport.height - height - DOCK;

  return {
    position: {
      x: Math.max(MARGIN, Math.min(bounds.position.x, maxX)),
      y: Math.max(TOP_BAR, Math.min(bounds.position.y, maxY)),
    },
    size: { width, height },
  };
}

/**
 * 目前的畫面尺寸。在沒有 DOM 的環境（測試、SSR）回傳一個保守的預設值，
 * 而不是讓 store 爆掉。
 */
export function currentViewport(): Viewport {
  if (typeof globalThis.window === "undefined") return { width: 1280, height: 800 };
  return { width: globalThis.window.innerWidth, height: globalThis.window.innerHeight };
}
