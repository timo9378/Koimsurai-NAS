import { describe, expect, it } from "vitest";
import { emptyMessage } from "./empty-state";

const base = { isTrashMode: false, query: "", tag: null };

describe("emptyMessage", () => {
  it("空資料夾", () => {
    expect(emptyMessage(base)).toBe("這個資料夾是空的");
  });

  it("垃圾桶是空的", () => {
    expect(emptyMessage({ ...base, isTrashMode: true })).toBe("垃圾桶是空的");
  });

  it("有搜尋條件時說的是「找不到」，不是「資料夾是空的」", () => {
    // 有篩選條件時「這個資料夾是空的」根本不是事實。
    expect(emptyMessage({ ...base, query: "報告" })).toBe("找不到符合「報告」的項目");
  });

  it("搜尋優先於垃圾桶與標籤", () => {
    expect(emptyMessage({ isTrashMode: true, query: "x", tag: "工作" })).toContain("找不到");
  });

  it("只有空白的搜尋字串不算在搜尋", () => {
    expect(emptyMessage({ ...base, query: "   " })).toBe("這個資料夾是空的");
  });

  it("搜尋字串顯示時去掉頭尾空白", () => {
    expect(emptyMessage({ ...base, query: "  報告  " })).toBe("找不到符合「報告」的項目");
  });

  it("標籤篩選", () => {
    expect(emptyMessage({ ...base, tag: "工作" })).toBe("沒有標記為「工作」的檔案");
  });
});
