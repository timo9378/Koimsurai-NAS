import { describe, expect, it } from "vitest";
import { emptySelection, selectOnClick, type SelectionState } from "./selection";

const FILES = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];

const plain = { shift: false, toggle: false };
const ctrl = { shift: false, toggle: true };
const shift = { shift: true, toggle: false };
const ctrlShift = { shift: true, toggle: true };

/** 把選取攤成排序後的陣列，斷言才讀得懂。 */
const names = (s: SelectionState) => [...s.selected].sort();

/** 依序點一連串 (index, modifiers)。 */
const clicks = (steps: [number, { shift: boolean; toggle: boolean }][]) =>
  steps.reduce((s, [i, m]) => selectOnClick(s, FILES, i, m), emptySelection);

describe("一般點擊", () => {
  it("只選取被點的那一個，並成為新的錨點", () => {
    const s = clicks([[2, plain]]);
    expect(names(s)).toEqual(["c.txt"]);
    expect(s.anchorIndex).toBe(2);
  });

  it("再點別的會取代前一次的選取", () => {
    const s = clicks([
      [2, plain],
      [0, plain],
    ]);
    expect(names(s)).toEqual(["a.txt"]);
  });
});

describe("Ctrl/Cmd+Click", () => {
  it("加入而不清掉既有選取", () => {
    const s = clicks([
      [0, plain],
      [2, ctrl],
    ]);
    expect(names(s)).toEqual(["a.txt", "c.txt"]);
  });

  it("再點一次同一個會取消選取", () => {
    const s = clicks([
      [0, plain],
      [2, ctrl],
      [2, ctrl],
    ]);
    expect(names(s)).toEqual(["a.txt"]);
  });

  it("會更新錨點", () => {
    expect(
      clicks([
        [0, plain],
        [3, ctrl],
      ]).anchorIndex,
    ).toBe(3);
  });
});

describe("Shift+Click", () => {
  it("選取錨點到點擊處之間的全部", () => {
    const s = clicks([
      [1, plain],
      [3, shift],
    ]);
    expect(names(s)).toEqual(["b.txt", "c.txt", "d.txt"]);
  });

  it("往回點也一樣（範圍不分方向）", () => {
    const s = clicks([
      [3, plain],
      [1, shift],
    ]);
    expect(names(s)).toEqual(["b.txt", "c.txt", "d.txt"]);
  });

  it("⚠️ 錨點不更新 —— 連續 Shift+Click 要能從同一個起點延伸／縮小範圍", () => {
    const s = clicks([
      [1, plain],
      [3, shift], // b,c,d
      [4, shift], // 從 1 延伸到 4
    ]);
    expect(names(s)).toEqual(["b.txt", "c.txt", "d.txt", "e.txt"]);
    expect(s.anchorIndex).toBe(1);
  });

  it("沒有錨點時退化成一般點擊", () => {
    const s = selectOnClick(emptySelection, FILES, 2, shift);
    expect(names(s)).toEqual(["c.txt"]);
    expect(s.anchorIndex).toBe(2);
  });

  it("Ctrl+Shift 會把新範圍**加進**既有選取", () => {
    const s = clicks([
      [0, plain], // a
      [4, ctrl], // a, e（錨點 4）
      [2, ctrlShift], // 加上 2..4
    ]);
    expect(names(s)).toEqual(["a.txt", "c.txt", "d.txt", "e.txt"]);
  });
});

describe("邊界", () => {
  it("點到不在清單裡的位置（index 為 -1）時原封不動", () => {
    // ⚠️ findIndex 找不到會回 -1。拿它去算範圍會得到一段含負索引的區間，
    //    而拿它當錨點則會讓下一次 Shift+Click 的起點是垃圾。
    const before = clicks([[1, plain]]);
    expect(selectOnClick(before, FILES, -1, plain)).toBe(before);
    expect(selectOnClick(before, FILES, -1, shift)).toBe(before);
    expect(selectOnClick(before, FILES, 99, plain)).toBe(before);
  });

  it("空清單不會爆炸", () => {
    expect(selectOnClick(emptySelection, [], 0, plain)).toBe(emptySelection);
  });

  it("回傳新的 Set，不會就地改動傳進來的那個", () => {
    const before = clicks([[0, plain]]);
    const after = selectOnClick(before, FILES, 2, ctrl);
    expect(names(before)).toEqual(["a.txt"]);
    expect(names(after)).toEqual(["a.txt", "c.txt"]);
  });
});
