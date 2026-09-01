import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, parseApiTimestamp, timestampOf } from "./datetime";

describe("parseApiTimestamp", () => {
  it("Unix 秒的字串 —— 後端實際送的就是這個", () => {
    // ⚠️ `new Date("1782355562")` 是 Invalid Date，這正是原本壞掉的原因。
    expect(parseApiTimestamp("1782355562")?.getTime()).toBe(1782355562_000);
  });

  it("數字形式也吃", () => {
    expect(parseApiTimestamp(1782355562)?.getTime()).toBe(1782355562_000);
  });

  it("ISO 字串也吃 —— 後端哪天改成送正常日期時不會再壞一次", () => {
    expect(parseApiTimestamp("2026-06-25T02:46:02Z")?.toISOString()).toBe(
      "2026-06-25T02:46:02.000Z",
    );
  });

  it("1970 之前（負的秒數）", () => {
    expect(parseApiTimestamp("-86400")?.getTime()).toBe(-86_400_000);
  });

  it("解不出來的回 null 而不是 Invalid Date", () => {
    expect(parseApiTimestamp("爛字串")).toBeNull();
    expect(parseApiTimestamp("")).toBeNull();
    expect(parseApiTimestamp(null)).toBeNull();
    expect(parseApiTimestamp(undefined)).toBeNull();
    expect(parseApiTimestamp(Number.NaN)).toBeNull();
  });

  it("頭尾空白不影響", () => {
    expect(parseApiTimestamp("  1782355562 ")?.getTime()).toBe(1782355562_000);
  });
});

describe("timestampOf", () => {
  it("排序用：解不出來的排最後（最舊）", () => {
    expect(timestampOf("爛字串")).toBe(-Infinity);
    expect(timestampOf(null)).toBe(-Infinity);
  });

  it("較新的秒數比較大 —— 原本每一項都是 -Infinity，排序等於沒作用", () => {
    expect(timestampOf("1782355562")).toBeGreaterThan(timestampOf("1700000000"));
  });

  it("永遠不會回 NaN —— 回 NaN 的比較函式會讓 sort 的結果變成實作定義", () => {
    for (const v of ["x", "", "0", "1782355562", null, undefined]) {
      expect(Number.isNaN(timestampOf(v))).toBe(false);
    }
  });
});

describe("formatDateTime / formatDate", () => {
  it("正常值格式得出來", () => {
    expect(formatDateTime("1782355562")).toBe(new Date(1782355562_000).toLocaleString());
    expect(formatDate("1782355562")).toBe(new Date(1782355562_000).toLocaleDateString());
  });

  it("壞值顯示破折號，不是「Invalid Date」", () => {
    expect(formatDateTime("爛字串")).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});
