import { describe, expect, it } from "vitest";
import {
  defaultIconPosition,
  DESKTOP_PADDING,
  GRID_GAP,
  GRID_SIZE,
  gridToPixels,
  snapToGrid,
  TOP_BAR_HEIGHT,
} from "./icon-grid";

const STEP = GRID_SIZE + GRID_GAP;

describe("defaultIconPosition", () => {
  it("⚠️ 先往下排、再往右（跟 macOS 桌面一致）", () => {
    // 對調 Math.floor 與 % 會變成先往右，那不會有任何錯誤，
    // 只是整個桌面的圖示順序被轉置。
    expect(defaultIconPosition(0, 8)).toEqual({ col: 0, row: 0 });
    expect(defaultIconPosition(1, 8)).toEqual({ col: 0, row: 1 });
    expect(defaultIconPosition(7, 8)).toEqual({ col: 0, row: 7 });
  });

  it("排滿一欄之後換下一欄", () => {
    expect(defaultIconPosition(8, 8)).toEqual({ col: 1, row: 0 });
    expect(defaultIconPosition(9, 8)).toEqual({ col: 1, row: 1 });
    expect(defaultIconPosition(16, 8)).toEqual({ col: 2, row: 0 });
  });

  it("同一批索引不會有兩個落在同一格", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const p = defaultIconPosition(i, 8);
        return `${p.col},${p.row}`;
      }),
    );
    expect(seen.size).toBe(40);
  });

  it("每欄數量不合法時直接丟錯，不要回 NaN", () => {
    // index % 0 是 NaN，會一路傳到 style 上變成看不見的圖示
    expect(() => defaultIconPosition(0, 0)).toThrow(RangeError);
    expect(() => defaultIconPosition(0, -1)).toThrow(RangeError);
  });
});

describe("snapToGrid", () => {
  it("落在格子中心會吸附到那一格", () => {
    const x = DESKTOP_PADDING + STEP * 2;
    const y = TOP_BAR_HEIGHT + DESKTOP_PADDING + STEP * 3;
    expect(snapToGrid(x, y)).toEqual({ col: 2, row: 3 });
  });

  it("落在兩格之間會吸到較近的那一格", () => {
    const justOver = DESKTOP_PADDING + STEP * 1 + STEP * 0.6;
    expect(snapToGrid(justOver, TOP_BAR_HEIGHT + DESKTOP_PADDING).col).toBe(2);
    const justUnder = DESKTOP_PADDING + STEP * 1 + STEP * 0.4;
    expect(snapToGrid(justUnder, TOP_BAR_HEIGHT + DESKTOP_PADDING).col).toBe(1);
  });

  it("⚠️ 拖到狀態列上方或桌面左緣外要夾在 0，不能是負的", () => {
    // 負的 row/col 會讓圖示跑到畫面外再也點不到，而且那個位置會被寫進
    // localStorage —— 重新整理也回不來。
    expect(snapToGrid(0, 0)).toEqual({ col: 0, row: 0 });
    expect(snapToGrid(-9999, -9999)).toEqual({ col: 0, row: 0 });
    expect(snapToGrid(DESKTOP_PADDING, 0).row).toBe(0);
  });

  it("gridToPixels 與 snapToGrid 是互逆的", () => {
    for (const pos of [
      { col: 0, row: 0 },
      { col: 3, row: 1 },
      { col: 7, row: 5 },
    ]) {
      const { x, y } = gridToPixels(pos);
      expect(snapToGrid(x + DESKTOP_PADDING, y + TOP_BAR_HEIGHT + DESKTOP_PADDING)).toEqual(pos);
    }
  });
});
