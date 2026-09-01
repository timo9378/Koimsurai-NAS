import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { planRename } from "./rename";

describe("planRename", () => {
  it("沒有在重新命名時什麼都不做", () => {
    expect(planRename(null, "任何東西")).toEqual({ kind: "cancel" });
  });

  it("名稱沒變就取消", () => {
    expect(planRename("報告.txt", "報告.txt")).toEqual({ kind: "cancel" });
  });

  it("清空就取消，不是改成空名稱", () => {
    expect(planRename("報告.txt", "")).toEqual({ kind: "cancel" });
  });

  it("全是空白也算取消", () => {
    // ⚠️ 原本只擋空字串，`"   "` 會被送到伺服器 —— 使用者把名字刪光再打幾個
    // 空白，就會建出一個叫 "   " 的檔案（或拿到籠統的失敗）
    expect(planRename("報告.txt", "   ")).toEqual({ kind: "cancel" });
    expect(planRename("報告.txt", "\t\n ")).toEqual({ kind: "cancel" });
  });

  it("去掉前後空白之後才送", () => {
    // "報告.txt " 跟 "報告.txt" 在畫面上看起來一模一樣
    expect(planRename("a.txt", "  報告.txt  ")).toEqual({ kind: "rename", name: "報告.txt" });
  });

  it("trim 之後跟原名相同也算取消", () => {
    expect(planRename("報告.txt", "  報告.txt  ")).toEqual({ kind: "cancel" });
  });

  it("路徑分隔符要當場擋下並說明原因", () => {
    // 送出去的話後端會以 403 拒絕，而 UI 只顯示籠統的 "Failed to rename file"
    expect(planRename("a.txt", "sub/a.txt")).toEqual({
      kind: "invalid",
      reason: "名稱不能包含 /",
    });
    expect(planRename("a.txt", "sub\\a.txt")).toEqual({
      kind: "invalid",
      reason: "名稱不能包含 \\",
    });
  });

  it("NUL 要顯示成 NUL 而不是裸的位元組", () => {
    // ⚠️ 把 \0 直接放進訊息裡，畫面上是一個看不見的字元 ——
    // 使用者看到的是「名稱不能包含 」，等於沒說。
    expect(planRename("a.txt", "a\0.txt")).toEqual({
      kind: "invalid",
      reason: "名稱不能包含 NUL",
    });
  });

  it(". 與 .. 是路徑語意不是名字", () => {
    expect(planRename("a.txt", ".")).toEqual({ kind: "invalid", reason: "名稱不能是 . 或 .." });
    expect(planRename("a.txt", "..")).toEqual({ kind: "invalid", reason: "名稱不能是 . 或 .." });
    // 但以點開頭的正常檔名要放行
    expect(planRename("a.txt", ".gitignore")).toEqual({ kind: "rename", name: ".gitignore" });
    expect(planRename("a.txt", "..a")).toEqual({ kind: "rename", name: "..a" });
  });

  it("性質：kind 是 rename 時，名稱一定沒有前後空白也沒有分隔符", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (current, next) => {
        const plan = planRename(current, next);
        if (plan.kind === "rename") {
          expect(plan.name).toBe(plan.name.trim());
          expect(plan.name).not.toBe("");
          expect(plan.name.includes("/")).toBe(false);
          expect(plan.name.includes("\\")).toBe(false);
          expect(plan.name.includes("\0")).toBe(false);
          expect(plan.name).not.toBe(current);
        }
      }),
    );
  });
});
