import { describe, expect, it } from "vitest";
import { planChunks } from "./chunk-plan";

/** 用小的分塊大小讓斷言讀得懂。 */
const K = 100;

describe("planChunks", () => {
  it("從頭開始時切成等長的塊，最後一塊補齊到檔尾", () => {
    expect(planChunks(250, 0, K)).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 200 },
      { start: 200, end: 250 },
    ]);
  });

  it("剛好整除時不會多出一塊空的", () => {
    expect(planChunks(200, 0, K)).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 200 },
    ]);
  });

  it("對齊分塊邊界的續傳從下一塊接續", () => {
    expect(planChunks(250, 100, K)).toEqual([
      { start: 100, end: 200 },
      { start: 200, end: 250 },
    ]);
  });

  it("⚠️ 沒對齊的續傳要從那個位元組本身開始，不能退回分塊開頭", () => {
    // 這是這支檔案存在的理由。斷在 150 的話必須從 150 續傳；
    // 舊寫法會從 100 重送，把已經寫進伺服器的 50 個位元組再送一次
    // —— 伺服器是 append，結果是比原檔長 50 bytes 且內容錯位的檔案。
    expect(planChunks(250, 150, K)).toEqual([{ start: 150, end: 250 }]);
  });

  it("沒對齊且剩餘超過一塊時，後續仍照分塊大小切", () => {
    expect(planChunks(400, 150, K)).toEqual([
      { start: 150, end: 250 },
      { start: 250, end: 350 },
      { start: 350, end: 400 },
    ]);
  });

  it("已經傳完（offset 等於檔案大小）就沒有東西要送", () => {
    expect(planChunks(250, 250, K)).toEqual([]);
  });

  it("offset 超過檔案大小也是空的，不會產生負長度的塊", () => {
    expect(planChunks(250, 9999, K)).toEqual([]);
  });

  it("負的 offset 當成從頭開始", () => {
    expect(planChunks(150, -10, K)).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 150 },
    ]);
  });

  it("⚠️ 空檔案要送一塊空的", () => {
    // 不送的話伺服器的工作階段永遠達不到「已收 >= 總長」而完成，
    // 檔案就一直卡在 .temp_uploads 裡，而前端顯示上傳成功。
    expect(planChunks(0, 0, K)).toEqual([{ start: 0, end: 0 }]);
    // 已經送過了就不要再送
    expect(planChunks(0, 1, K)).toEqual([]);
  });

  it("每一塊都不超過分塊大小，且首尾相接沒有洞", () => {
    const chunks = planChunks(1234, 0, K);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(1234);
    for (const [i, c] of chunks.entries()) {
      expect(c.end - c.start).toBeLessThanOrEqual(K);
      expect(c.end).toBeGreaterThan(c.start);
      if (i > 0) expect(c.start).toBe(chunks[i - 1]?.end);
    }
  });

  it("分塊大小不合法時直接丟錯，不要產生無窮迴圈", () => {
    // start += 0 會是一個永遠不結束的迴圈
    expect(() => planChunks(100, 0, 0)).toThrow(RangeError);
    expect(() => planChunks(100, 0, -1)).toThrow(RangeError);
  });
});
