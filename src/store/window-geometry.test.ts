import { describe, expect, it } from "vitest";

import {
  DOCK,
  MARGIN,
  MIN_HEIGHT,
  MIN_WIDTH,
  TOP_BAR,
  fitToViewport,
  type Bounds,
} from "./window-geometry";

const at = (x: number, y: number, width: number, height: number): Bounds => ({
  position: { x, y },
  size: { width, height },
});

/** 視窗完全在看得見的範圍內。 */
function isVisible(b: Bounds, vw: number, vh: number) {
  return (
    b.position.x >= 0 &&
    b.position.y >= TOP_BAR &&
    b.position.x + b.size.width <= vw &&
    b.position.y + b.size.height <= vh
  );
}

describe("fitToViewport", () => {
  it("放得下的視窗原封不動", () => {
    const b = at(100, 100, 800, 500);
    expect(fitToViewport(b, { width: 1920, height: 1080 })).toEqual(b);
  });

  // 這就是使用者遇到的那個情況：1280×720 的畫面、第二個開啟的 preview 視窗。
  it("底部超出畫面的視窗會被拉回來（實際炸掉的那組數字）", () => {
    const out = fitToViewport(at(120, 120, 900, 700), { width: 1280, height: 720 });
    expect(out.position.y + out.size.height).toBeLessThanOrEqual(720 - DOCK);
    expect(isVisible(out, 1280, 720)).toBe(true);
  });

  it("比畫面還大的視窗會被縮到放得下", () => {
    const out = fitToViewport(at(0, 0, 3000, 3000), { width: 1280, height: 720 });
    expect(out.size.width).toBe(1280 - MARGIN * 2);
    expect(out.size.height).toBe(720 - TOP_BAR - DOCK);
    expect(isVisible(out, 1280, 720)).toBe(true);
  });

  // 順序寫反的話會先把視窗推到 y = TOP_BAR、再縮小，底部就會空一塊。
  it("先夾大小再夾位置：縮小後仍然貼齊可用區域", () => {
    const vh = 720;
    const out = fitToViewport(at(500, 500, 2000, 2000), { width: 1280, height: vh });
    expect(out.position.y).toBe(TOP_BAR);
    expect(out.position.y + out.size.height).toBe(vh - DOCK);
  });

  it("不會躲到選單列後面", () => {
    const out = fitToViewport(at(100, 0, 400, 300), { width: 1280, height: 720 });
    expect(out.position.y).toBeGreaterThanOrEqual(TOP_BAR);
  });

  it("負座標會被拉回畫面內", () => {
    const out = fitToViewport(at(-500, -500, 400, 300), { width: 1280, height: 720 });
    expect(out.position.x).toBe(MARGIN);
    expect(out.position.y).toBe(TOP_BAR);
  });

  it("右邊超出畫面的視窗會靠回右緣", () => {
    const out = fitToViewport(at(1200, 100, 800, 400), { width: 1280, height: 720 });
    expect(out.position.x + out.size.width).toBe(1280 - MARGIN);
  });

  // ⚠️ 這條在意的是「畫面比最小視窗還小」時不能夾出負座標 ——
  // 標題列跑到畫面左外側的話，連把它拖回來都做不到。
  it("畫面比最小尺寸還窄時，標題列仍然在畫面內", () => {
    const out = fitToViewport(at(100, 100, 800, 600), { width: 320, height: 480 });
    // 寬度撐不下 MIN_WIDTH，所以停在 MIN_WIDTH（視窗會比畫面寬，但這比夾成
    // 一條縫好）；高度還有 480-32-80=368 可用，就用 368。
    expect(out.size.width).toBe(MIN_WIDTH);
    expect(out.size.height).toBe(480 - TOP_BAR - DOCK);
    // 重點在這兩行：座標不可以是負的，否則標題列在畫面外，拖都拖不回來。
    expect(out.position.x).toBe(MARGIN);
    expect(out.position.y).toBe(TOP_BAR);
  });

  it("永遠不會夾出比手動縮放下限還小的視窗", () => {
    for (const [w, h] of [
      [320, 480],
      [640, 400],
      [1024, 300],
      [1280, 720],
    ] as const) {
      const out = fitToViewport(at(0, 0, 100, 100), { width: w, height: h });
      expect(out.size.width).toBeGreaterThanOrEqual(Math.min(100, MIN_WIDTH));
      expect(out.size.height).toBeGreaterThanOrEqual(Math.min(100, MIN_HEIGHT));
    }
  });

  it("小視窗不會被放大", () => {
    const out = fitToViewport(at(100, 100, 320, 300), { width: 1920, height: 1080 });
    expect(out.size).toEqual({ width: 320, height: 300 });
  });
});
