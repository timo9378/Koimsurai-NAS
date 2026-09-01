import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("一般範圍", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 3)).toBe("1 GB");
    expect(formatBytes(1024 ** 4)).toBe("1 TB");
  });

  it("尾端的 .0 會去掉", () => {
    // MobileLayout 的那份沒有 parseFloat，所以顯示的是 "1.0 KB"
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(2 * 1024 ** 2)).toBe("2 MB");
  });

  it("超過 TB 不會變成 undefined", () => {
    // ⚠️ 原本六份實作的單位表只到 TB，1 PiB 顯示的是字面的 "1 undefined"。
    // Dashboard 會把所有磁碟的 total_space 加總，所以這不是幻想。
    expect(formatBytes(1024 ** 5)).toBe("1 PB");
    expect(formatBytes(1024 ** 6)).toBe("1 EB");
    // 再往上就夾在最大單位，而不是掉出表格
    expect(formatBytes(1024 ** 8)).toBe("1048576 EB");
  });

  it("無效的輸入顯示「不知道」而不是說謊", () => {
    // 原本六份實作對這些全都回字面的 "NaN undefined"
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(-1024)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("小於一位元組的正數不會掉到 index 負數", () => {
    // Math.floor(log(0.5)/log(1024)) 是 -1，原本會取到 UNITS[-1]
    expect(formatBytes(0.5)).toBe("0.5 B");
  });

  it("可以指定小數位數", () => {
    expect(formatBytes(1536, 2)).toBe("1.5 KB");
    expect(formatBytes(1590, 2)).toBe("1.55 KB");
    expect(formatBytes(1590, 0)).toBe("2 KB");
  });

  it("性質：任何有限的非負數都產生「數字 + 空格 + 已知單位」", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: Number.MAX_SAFE_INTEGER, noNaN: true }), (bytes) => {
        const out = formatBytes(bytes);
        const [value, unit] = out.split(" ");
        expect(unit).toMatch(/^(B|KB|MB|GB|TB|PB|EB)$/);
        expect(Number.isNaN(Number(value))).toBe(false);
      }),
    );
  });

  it("性質：越大的位元組數不會顯示成越小的單位", () => {
    const rank = (s: string) =>
      ["B", "KB", "MB", "GB", "TB", "PB", "EB"].indexOf(s.split(" ")[1] ?? "");
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2 ** 53, noNaN: true }),
        fc.double({ min: 0, max: 2 ** 53, noNaN: true }),
        (a, b) => {
          const [small, large] = a <= b ? [a, b] : [b, a];
          expect(rank(formatBytes(small))).toBeLessThanOrEqual(rank(formatBytes(large)));
        },
      ),
    );
  });
});
