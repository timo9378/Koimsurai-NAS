import fc from "fast-check";
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

describe("性質（fast-check）", () => {
  it("gridToPixels 之後 snapToGrid 一定回到原格（往返恆等）", () => {
    fc.assert(
      fc.property(fc.nat({ max: 200 }), fc.nat({ max: 200 }), (col, row) => {
        const { x, y } = gridToPixels({ col, row });
        expect(snapToGrid(x + DESKTOP_PADDING, y + TOP_BAR_HEIGHT + DESKTOP_PADDING)).toEqual({
          col,
          row,
        });
      }),
    );
  });

  it("snapToGrid 永遠不會回負值 —— 負的座標會讓圖示跑到畫面外再也點不到", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000, max: 50_000 }),
        fc.integer({ min: -50_000, max: 50_000 }),
        (x, y) => {
          const p = snapToGrid(x, y);
          expect(p.col).toBeGreaterThanOrEqual(0);
          expect(p.row).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("不同的 index 一定落在不同格", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.nat({ max: 300 }), (perColumn, count) => {
        const cells = Array.from({ length: count }, (_, i) => {
          const p = defaultIconPosition(i, perColumn);
          return `${p.col},${p.row}`;
        });
        expect(new Set(cells).size).toBe(count);
      }),
    );
  });
});

// ── Stryker 指出來的缺口 ────────────────────────────────────────────
//
// ⚠️ 往返型的 property test（`snapToGrid ∘ gridToPixels = id`）有個盲點：
// 兩個方向共用同一組常數，常數錯了會**互相抵消**。變異測試把
// `clientY - TOP_BAR_HEIGHT - DESKTOP_PADDING` 的第二個減號改成加號，
// 往返測試照樣過。要釘住的是絕對座標，所以這裡放死值。
describe("絕對座標（往返測試蓋不到的部分）", () => {
  it("桌面左上角第一格的落點", () => {
    // 圖示區從 TOP_BAR_HEIGHT(48) + DESKTOP_PADDING(16) 開始，左緣是 16
    expect(snapToGrid(16, 64)).toEqual({ col: 0, row: 0 });
  });

  it("往右下各一格 = 各加 GRID_SIZE + GRID_GAP", () => {
    expect(snapToGrid(16 + 108, 64 + 108)).toEqual({ col: 1, row: 1 });
  });

  it("頂端狀態列的高度真的被扣掉", () => {
    // y=100：扣掉 48+16 = 36，36/108 = 0.33 → 第 0 列。
    // 如果 padding 被加而不是減（36 → 68），0.63 就會進位成第 1 列。
    expect(snapToGrid(0, 100).row).toBe(0);
    // y=130：扣掉後 66，66/108 = 0.61 → 第 1 列
    expect(snapToGrid(0, 130).row).toBe(1);
  });

  it("iconsPerColumn 非正數時的錯誤訊息帶著收到的值", () => {
    expect(() => defaultIconPosition(0, 0)).toThrow(/iconsPerColumn/);
    expect(() => defaultIconPosition(0, -1)).toThrow(/-1/);
  });
});
