import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { filterByQuery, sortFiles } from "./sorting";

interface F {
  name: string;
  size: number;
  modified: string;
  is_dir: boolean;
}
const f = (name: string, size = 0, modified = "2026-01-01T00:00:00Z", is_dir = false): F => ({
  name,
  size,
  modified,
  is_dir,
});

describe("filterByQuery", () => {
  it("不分大小寫的包含比對", () => {
    const files = [f("Report.txt"), f("notes.md"), f("REPORT-2.txt")];
    expect(filterByQuery(files, "report").map((x) => x.name)).toEqual([
      "Report.txt",
      "REPORT-2.txt",
    ]);
  });

  it("空查詢回全部（含只有空白的）", () => {
    const files = [f("a"), f("b")];
    expect(filterByQuery(files, "")).toHaveLength(2);
    expect(filterByQuery(files, "   ")).toHaveLength(2);
  });

  it("不修改原陣列", () => {
    const files = [f("a"), f("b")];
    filterByQuery(files, "a");
    expect(files).toHaveLength(2);
  });
});

describe("sortFiles", () => {
  it("資料夾永遠在前面 —— 降冪也是", () => {
    // ⚠️ 把資料夾優先放進 comparison 裡的話，降冪會把資料夾排到最後，
    // 而那不是任何檔案管理器的行為
    const files = [f("b.txt"), f("a-dir", 0, "2026-01-01T00:00:00Z", true), f("a.txt")];
    expect(sortFiles(files, "name", "asc").map((x) => x.name)).toEqual(["a-dir", "a.txt", "b.txt"]);
    expect(sortFiles(files, "name", "desc").map((x) => x.name)).toEqual([
      "a-dir",
      "b.txt",
      "a.txt",
    ]);
  });

  it("名稱排序不分大小寫", () => {
    // 跟後端的 COLLATE NOCASE 對齊。沒有 sensitivity: "base" 的話
    // "ABC" 與 "abc" 中間會隔著整個字母表
    const files = [f("banana"), f("Apple"), f("ABC"), f("abc2")];
    expect(sortFiles(files, "name", "asc").map((x) => x.name)).toEqual([
      "ABC",
      "abc2",
      "Apple",
      "banana",
    ]);
  });

  it("數字用自然順序而不是字典順序", () => {
    // "file10" 應該排在 "file9" 後面
    const files = [f("file10.txt"), f("file9.txt"), f("file1.txt")];
    expect(sortFiles(files, "name", "asc").map((x) => x.name)).toEqual([
      "file1.txt",
      "file9.txt",
      "file10.txt",
    ]);
  });

  it("依大小與時間排序", () => {
    const files = [f("a", 300), f("b", 100), f("c", 200)];
    expect(sortFiles(files, "size", "asc").map((x) => x.name)).toEqual(["b", "c", "a"]);
    expect(sortFiles(files, "size", "desc").map((x) => x.name)).toEqual(["a", "c", "b"]);

    const dated = [
      f("old", 0, "2020-01-01T00:00:00Z"),
      f("new", 0, "2026-06-01T00:00:00Z"),
      f("mid", 0, "2023-01-01T00:00:00Z"),
    ];
    expect(sortFiles(dated, "modified", "asc").map((x) => x.name)).toEqual(["old", "mid", "new"]);
  });

  it("無效的日期當成最舊，不會讓比較函式回 NaN", () => {
    // ⚠️ 回 NaN 的比較函式會讓 Array.sort 的結果變成實作定義的順序 ——
    // 不報錯，只是順序莫名其妙，而且不同瀏覽器可能不一樣
    const files = [f("good", 0, "2026-01-01T00:00:00Z"), f("broken", 0, "不是日期")];
    expect(sortFiles(files, "modified", "asc").map((x) => x.name)).toEqual(["broken", "good"]);
  });

  it("不修改原陣列", () => {
    const files = [f("b"), f("a")];
    sortFiles(files, "name", "asc");
    expect(files.map((x) => x.name)).toEqual(["b", "a"]);
  });

  it("性質：排序不增減項目", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string(), size: fc.nat(), is_dir: fc.boolean() }), {
          maxLength: 30,
        }),
        fc.constantFrom("name" as const, "size" as const, "modified" as const),
        fc.constantFrom("asc" as const, "desc" as const),
        (raw, field, dir) => {
          const files = raw.map((r) => ({ ...r, modified: "2026-01-01T00:00:00Z" }));
          const sorted = sortFiles(files, field, dir);
          expect(sorted).toHaveLength(files.length);
          // ⚠️ 比較多重集合要用穩定的鍵。`[...arr].sort()` 不給比較函式時是按
          // **字串化**排序，物件全都變成 "[object Object]" —— 等於沒排，
          // 而那個斷言就形同虛設。
          const key = (xs: readonly F[]) => xs.map((x) => JSON.stringify(x)).sort();
          expect(key(sorted)).toEqual(key(files));
        },
      ),
    );
  });

  it("性質：資料夾一定全部排在檔案前面", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string(), size: fc.nat(), is_dir: fc.boolean() }), {
          maxLength: 30,
        }),
        fc.constantFrom("name" as const, "size" as const, "modified" as const),
        fc.constantFrom("asc" as const, "desc" as const),
        (raw, field, dir) => {
          const files = raw.map((r) => ({ ...r, modified: "2026-01-01T00:00:00Z" }));
          const sorted = sortFiles(files, field, dir);
          const firstFile = sorted.findIndex((x) => !x.is_dir);
          if (firstFile >= 0) {
            expect(sorted.slice(firstFile).every((x) => !x.is_dir)).toBe(true);
          }
        },
      ),
    );
  });
});
