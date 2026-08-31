import fc from "fast-check";
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

describe("性質（fast-check）", () => {
  /**
   * ⚠️ 上面那條「首尾相接沒有洞」本來就是一個性質，卻只餵了一組輸入。
   * 分塊計畫的正確性只有一句話：**它必須剛好鋪滿 [startOffset, fileSize)**。
   * 少一塊 = 檔案截斷；多一塊或重疊 = 伺服器 append 模式下檔案變長且錯位。
   * 兩種都不會有錯誤訊息。
   */
  it("分塊剛好鋪滿 [startOffset, fileSize)，不重疊也沒有洞", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100_000 }),
        fc.nat({ max: 100_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (fileSize, rawOffset, chunkSize) => {
          const offset = Math.min(rawOffset, fileSize);
          const chunks = planChunks(fileSize, offset, chunkSize);

          if (fileSize === 0) {
            expect(chunks).toEqual(offset > 0 ? [] : [{ start: 0, end: 0 }]);
            return;
          }
          if (offset >= fileSize) {
            expect(chunks).toEqual([]);
            return;
          }

          expect(chunks[0]?.start).toBe(offset);
          expect(chunks.at(-1)?.end).toBe(fileSize);

          // ⚠️ 迴圈裡**不要**用 expect。chunkSize 可以小到 1、fileSize 到 10 萬，
          // 單一 case 就有 10 萬塊，乘上 fast-check 的 100 次 run 是數千萬次
          // expect 呼叫 —— 開發機跑得完，CI runner 就撞上 5 秒逾時（實際發生過）。
          // 純算術先收斂成一個描述，最後只斷言一次；失敗時 fast-check 本來就會
          // 印出反例的輸入，訊息不會變難讀。
          let bad = "";
          for (const [i, c] of chunks.entries()) {
            const prev = chunks[i - 1];
            if (c.end <= c.start) {
              bad = `第 ${i} 塊是空的或反向：${c.start}–${c.end}`;
            } else if (c.end - c.start > chunkSize) {
              bad = `第 ${i} 塊比 chunkSize 大：${c.end - c.start} > ${chunkSize}`;
            } else if (i > 0 && prev !== undefined && c.start !== prev.end) {
              bad = `第 ${i} 塊跟前一塊之間有洞或重疊：${prev.end} → ${c.start}`;
            }
            if (bad !== "") break;
          }
          expect(bad).toBe("");
        },
      ),
    );
  });

  it("續傳不會重送任何已經傳過的位元組", () => {
    // 這正是修掉的那個 bug：`Math.floor(offset / chunkSize)` 會讓第一塊
    // 從 offset **之前**開始。
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.nat({ max: 100_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (fileSize, rawOffset, chunkSize) => {
          const offset = Math.min(rawOffset, fileSize);
          // 同上：迴圈裡不用 expect，先算出最小的 start 再斷言一次。
          const earliest = planChunks(fileSize, offset, chunkSize).reduce(
            (min, c) => Math.min(min, c.start),
            Number.POSITIVE_INFINITY,
          );
          if (earliest !== Number.POSITIVE_INFINITY) {
            expect(earliest).toBeGreaterThanOrEqual(offset);
          }
        },
      ),
    );
  });
});

// ── Stryker 指出來的缺口 ────────────────────────────────────────────
describe("預設分塊大小", () => {
  it("不給 chunkSize 時每塊是 5 MiB", () => {
    const FIVE_MIB = 5 * 1024 * 1024;
    const chunks = planChunks(FIVE_MIB + 1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ start: 0, end: FIVE_MIB });
    expect(chunks[1]).toEqual({ start: FIVE_MIB, end: FIVE_MIB + 1 });
  });

  it("chunkSize 非正數時的錯誤訊息帶著收到的值", () => {
    expect(() => planChunks(10, 0, 0)).toThrow(/chunkSize/);
    expect(() => planChunks(10, 0, -5)).toThrow(/-5/);
  });
});
