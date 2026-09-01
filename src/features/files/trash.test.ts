import { describe, expect, it } from "vitest";
import { collectTrashed } from "./trash";

const ok = (trash_name: string): PromiseSettledResult<{ trash_name: string }> => ({
  status: "fulfilled",
  value: { trash_name },
});
const fail: PromiseSettledResult<{ trash_name: string }> = {
  status: "rejected",
  reason: new Error("boom"),
};

describe("collectTrashed", () => {
  it("復原用的是垃圾桶檔名，不是原檔名", () => {
    const { trashed } = collectTrashed(["a.txt"], [ok("a.txt.1782355562")]);
    expect(trashed).toEqual([{ name: "a.txt", trashName: "a.txt.1782355562" }]);
  });

  it("一個失敗不會拖垮其餘成功的復原", () => {
    const { trashed, failed } = collectTrashed(["a", "b", "c"], [ok("a"), fail, ok("c.9")]);
    expect(trashed.map((t) => t.trashName)).toEqual(["a", "c.9"]);
    expect(failed).toEqual(["b"]);
  });

  it("全部失敗時沒有東西可以復原", () => {
    expect(collectTrashed(["a", "b"], [fail, fail])).toEqual({ trashed: [], failed: ["a", "b"] });
  });

  it("名字與結果是靠位置對起來的，順序要保住", () => {
    const { trashed } = collectTrashed(["第一", "第二"], [ok("t1"), ok("t2")]);
    expect(trashed).toEqual([
      { name: "第一", trashName: "t1" },
      { name: "第二", trashName: "t2" },
    ]);
  });

  it("結果比名字少的話，缺的算失敗而不是靜靜漏掉", () => {
    // allSettled 不會發生這件事，但這個函式不該在型別以外的地方才守得住。
    expect(collectTrashed(["a", "b"], [ok("a")])).toEqual({
      trashed: [{ name: "a", trashName: "a" }],
      failed: ["b"],
    });
  });
});
