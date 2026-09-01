import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { planMove } from "./move";

describe("planMove", () => {
  it("搬到別的目錄", () => {
    expect(planMove(["a.txt", "b.txt"], "/Documents", "/Photos")).toEqual({
      kind: "move",
      paths: ["Documents/a.txt", "Documents/b.txt"],
      destination: "Photos",
    });
  });

  it("從根目錄搬出去", () => {
    expect(planMove(["a.txt"], "/", "/Documents")).toEqual({
      kind: "move",
      paths: ["a.txt"],
      destination: "Documents",
    });
  });

  it("搬回根目錄 —— destination 是空字串不是斜線", () => {
    // ⚠️ 後端會把 destination 接在儲存根後面，"/" 會產生 "//檔名"
    expect(planMove(["a.txt"], "/Documents", "/")).toEqual({
      kind: "move",
      paths: ["Documents/a.txt"],
      destination: "",
    });
  });

  it("同一個目錄不用搬", () => {
    expect(planMove(["a.txt"], "/Documents", "/Documents")).toEqual({ kind: "noop" });
    // 結尾斜線不該讓它以為是不同目錄
    expect(planMove(["a.txt"], "/Documents", "/Documents/")).toEqual({ kind: "noop" });
    expect(planMove(["a.txt"], "/", "/")).toEqual({ kind: "noop" });
  });

  it("不能把資料夾搬進它自己", () => {
    expect(planMove(["sub"], "/Documents", "/Documents/sub")).toEqual({ kind: "noop" });
  });

  it("不能搬進自己底下的目錄", () => {
    // ⚠️ `mv a/b a/b/c` 在 Linux 上回 EINVAL —— 不會弄壞檔案，但使用者拿到的
    // 是籠統的「移動失敗」。正確的處置是根本不要送出這種請求。
    expect(planMove(["sub"], "/Documents", "/Documents/sub/deeper")).toEqual({ kind: "noop" });
  });

  it("只把自己過濾掉，其餘照搬", () => {
    expect(planMove(["sub", "a.txt"], "/Documents", "/Documents/sub")).toEqual({
      kind: "move",
      paths: ["Documents/a.txt"],
      destination: "Documents/sub",
    });
  });

  it("名稱相近的目錄不會被誤判成自己底下", () => {
    // "Documents/sub" 與 "Documents/subfolder" —— 用字串前綴比對而不看分隔符的話
    // 會把後者誤判成前者的子目錄
    expect(planMove(["sub"], "/Documents", "/Documents/subfolder")).toEqual({
      kind: "move",
      paths: ["Documents/sub"],
      destination: "Documents/subfolder",
    });
  });

  it("重複的名稱只送一次", () => {
    expect(planMove(["a.txt", "a.txt"], "/d", "/e")).toEqual({
      kind: "move",
      paths: ["d/a.txt"],
      destination: "e",
    });
  });

  it("沒有選任何東西就不用搬", () => {
    expect(planMove([], "/d", "/e")).toEqual({ kind: "noop" });
  });

  it("性質：送出去的路徑一定不含開頭斜線，也不會等於目的地", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
          { maxLength: 8 },
        ),
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
          { maxLength: 3 },
        ),
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
          { maxLength: 3 },
        ),
        (names, curSegs, destSegs) => {
          const cur = curSegs.length === 0 ? "/" : `/${curSegs.join("/")}`;
          const dest = destSegs.length === 0 ? "/" : `/${destSegs.join("/")}`;
          const plan = planMove(names, cur, dest);
          if (plan.kind === "move") {
            expect(plan.destination.startsWith("/")).toBe(false);
            for (const p of plan.paths) {
              expect(p.startsWith("/")).toBe(false);
              expect(p).not.toBe(plan.destination);
              // 目的地不該在來源底下
              expect(plan.destination.startsWith(`${p}/`)).toBe(false);
            }
          }
        },
      ),
    );
  });
});
