import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  GRID_CELL_HEIGHT,
  GRID_GAP,
  GRID_PADDING,
  gridColumns,
  itemsInMarquee,
  LIST_HEADER_HEIGHT,
  LIST_ROW_HEIGHT,
  type MarqueeBox,
} from "./marquee";

/** 一個寬到剛好排三欄的容器：padding*2 + 3*100 + 2*gap = 32 + 300 + 32 = 364 */
const W3 = 364;
const grid = { mode: "grid", containerWidth: W3 } as const;
const list = { mode: "list" } as const;

const box = (startX: number, startY: number, currentX: number, currentY: number): MarqueeBox => ({
  startX,
  startY,
  currentX,
  currentY,
});

describe("gridColumns", () => {
  it("依容器寬度算出 auto-fill 的欄數", () => {
    expect(gridColumns(W3)).toBe(3);
    expect(gridColumns(364 + 116)).toBe(4);
  });

  it("⚠️ 至少一欄 —— 容器還沒佈局完時 clientWidth 是 0", () => {
    // 0 欄的話 `index % cols` 會是 NaN，整個判定就壞了
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(-100)).toBe(1);
    expect(gridColumns(10)).toBe(1);
  });
});

describe("grid 框選", () => {
  it("框住第一格就只選第一個", () => {
    expect(
      itemsInMarquee(
        box(GRID_PADDING + 1, GRID_PADDING + 1, GRID_PADDING + 20, GRID_PADDING + 20),
        9,
        grid,
      ),
    ).toEqual([0]);
  });

  it("橫跨第一列會選到那一列的全部", () => {
    const y = GRID_PADDING + 10;
    expect(itemsInMarquee(box(0, y, W3, y + 10), 9, grid)).toEqual([0, 1, 2]);
  });

  it("往回拖也一樣（框不分方向）", () => {
    const y = GRID_PADDING + 10;
    expect(itemsInMarquee(box(W3, y + 10, 0, y), 9, grid)).toEqual([0, 1, 2]);
  });

  it("縱向跨兩列會選到兩列", () => {
    const secondRowTop = GRID_PADDING + GRID_CELL_HEIGHT + GRID_GAP;
    expect(itemsInMarquee(box(0, GRID_PADDING + 5, W3, secondRowTop + 5), 9, grid)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("落在格子之間的間隙裡不會選到任何東西", () => {
    // 第一列與第二列之間的 gap
    const gapY = GRID_PADDING + GRID_CELL_HEIGHT + GRID_GAP / 2;
    expect(itemsInMarquee(box(0, gapY, W3, gapY), 9, grid)).toEqual([]);
  });

  it("超出最後一個項目的框不會選到不存在的索引", () => {
    const hit = itemsInMarquee(box(0, 0, W3 * 2, 10_000), 4, grid);
    expect(hit).toEqual([0, 1, 2, 3]);
    expect(Math.max(...hit)).toBeLessThan(4);
  });

  it("⚠️ 容器寬度為 0 時回空的，不是全選", () => {
    // 尚未佈局時 clientWidth 是 0，算出來的 cell 寬是負數，矩形判定就沒有
    // 意義了。回全選的話症狀是「剛開啟視窗、隨手一點就選起整個資料夾」。
    expect(itemsInMarquee(box(0, 0, 500, 500), 9, { mode: "grid", containerWidth: 0 })).toEqual([]);
    expect(itemsInMarquee(box(0, 0, 500, 500), 9, { mode: "grid", containerWidth: 20 })).toEqual(
      [],
    );
  });

  it("空清單回空的", () => {
    expect(itemsInMarquee(box(0, 0, 500, 500), 0, grid)).toEqual([]);
  });
});

describe("list 框選", () => {
  it("依 Y 座標選到對應的列", () => {
    const firstRowMid = LIST_HEADER_HEIGHT + LIST_ROW_HEIGHT / 2;
    expect(itemsInMarquee(box(0, firstRowMid, 10, firstRowMid), 5, list)).toEqual([0]);
  });

  it("跨多列會全選到", () => {
    const from = LIST_HEADER_HEIGHT + 1;
    const to = LIST_HEADER_HEIGHT + LIST_ROW_HEIGHT * 2 + 1;
    expect(itemsInMarquee(box(0, from, 10, to), 5, list)).toEqual([0, 1, 2]);
  });

  it("⚠️ 刻意忽略 X —— 每列是整行寬的，在右邊空白處拖曳也要選得到", () => {
    const y = LIST_HEADER_HEIGHT + 5;
    expect(itemsInMarquee(box(9000, y, 9500, y), 3, list)).toEqual([0]);
  });

  it("停在 header 區域不會選到任何列", () => {
    expect(itemsInMarquee(box(0, 0, 100, LIST_HEADER_HEIGHT - 1), 5, list)).toEqual([]);
  });
});

describe("性質（fast-check）", () => {
  const coord = fc.integer({ min: -500, max: 2000 });
  const boxArb = fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]) => box(a, b, c, d));
  const count = fc.integer({ min: 0, max: 30 });

  it("回傳的索引一定在範圍內、遞增、且不重複", () => {
    fc.assert(
      fc.property(boxArb, count, fc.boolean(), (b, n, isGrid) => {
        const hit = itemsInMarquee(b, n, isGrid ? grid : list);
        expect(new Set(hit).size).toBe(hit.length);
        expect([...hit].sort((x, y) => x - y)).toEqual(hit);
        for (const i of hit) {
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(n);
        }
      }),
    );
  });

  it("框往外擴之後，選取只會增加不會減少（單調性）", () => {
    // ⚠️ 這是使用者對框選最直接的期待：拖大一點不該讓已經框到的東西掉出來。
    //    定樁測試很難蓋到這件事，因為它是「兩次呼叫之間的關係」而不是單一輸出。
    fc.assert(
      fc.property(boxArb, count, fc.nat({ max: 300 }), fc.boolean(), (b, n, grow, isGrid) => {
        const layout = isGrid ? grid : list;
        const inner = itemsInMarquee(b, n, layout);
        const outer = itemsInMarquee(
          box(
            Math.min(b.startX, b.currentX) - grow,
            Math.min(b.startY, b.currentY) - grow,
            Math.max(b.startX, b.currentX) + grow,
            Math.max(b.startY, b.currentY) + grow,
          ),
          n,
          layout,
        );
        for (const i of inner) expect(outer).toContain(i);
      }),
    );
  });

  it("框的兩個角互換不影響結果（方向無關）", () => {
    fc.assert(
      fc.property(boxArb, count, fc.boolean(), (b, n, isGrid) => {
        const layout = isGrid ? grid : list;
        expect(itemsInMarquee(box(b.currentX, b.currentY, b.startX, b.startY), n, layout)).toEqual(
          itemsInMarquee(b, n, layout),
        );
      }),
    );
  });

  it("容器寬度不足時 grid 一律回空的，不會變成全選", () => {
    fc.assert(
      fc.property(boxArb, count, fc.integer({ min: -100, max: 32 }), (b, n, width) => {
        expect(itemsInMarquee(b, n, { mode: "grid", containerWidth: width })).toEqual([]);
      }),
    );
  });
});
