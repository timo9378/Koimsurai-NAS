import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { joinPath, dirName, pathSegments, pathUpTo, toApiPath } from "./paths";

describe("joinPath", () => {
  it("根目錄不會產生雙斜線", () => {
    // 散落各處的三元式就是為了處理這一個情況；沒處理的話是 "//報告.txt"
    expect(joinPath("/", "報告.txt")).toBe("/報告.txt");
    expect(joinPath("", "報告.txt")).toBe("/報告.txt");
  });

  it("一般目錄", () => {
    expect(joinPath("/Documents", "報告.txt")).toBe("/Documents/報告.txt");
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
  });

  it("目錄帶結尾斜線也不會雙斜線", () => {
    expect(joinPath("/Documents/", "報告.txt")).toBe("/Documents/報告.txt");
    expect(joinPath("/a//", "b")).toBe("/a/b");
  });

  it("性質：結果永遠不含連續斜線", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
        (dir, name) => {
          expect(joinPath(dir, name)).not.toMatch(/\/\//);
        },
      ),
    );
  });
});

describe("dirName", () => {
  it("往上一層", () => {
    expect(dirName("/a/b/c")).toBe("/a/b");
    expect(dirName("/a/b")).toBe("/a");
    expect(dirName("/a")).toBe("/");
  });

  it("根目錄的上一層還是根目錄", () => {
    expect(dirName("/")).toBe("/");
    expect(dirName("")).toBe("/");
  });

  it("多個結尾斜線也要全部去掉", () => {
    // ⚠️ 變異測試逼出來的：把 /\/+$/ 的 `+` 拿掉之後只會去掉一個斜線，
    // "/a//" 會變成 "/a/"，於是 dirName 回的是 "/a" 而不是 "/"。
    expect(dirName("/a//")).toBe("/");
    expect(dirName("/a/b///")).toBe("/a");
    expect(dirName("//")).toBe("/");
  });

  it("結尾斜線不會讓它原地踏步", () => {
    // ⚠️ 原本的 substring(0, lastIndexOf("/")) 對 "/a/b/" 會回 "/a/b"（自己），
    // 症狀是「上一頁」按了沒反應
    expect(dirName("/a/b/")).toBe("/a");
    expect(dirName("/a/")).toBe("/");
  });

  it("性質：一路往上一定會走到根目錄，不會卡住", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
          { maxLength: 8 },
        ),
        (segments) => {
          let path = segments.length === 0 ? "/" : `/${segments.join("/")}`;
          for (let i = 0; i <= segments.length + 1; i++) {
            const next = dirName(path);
            expect(next.length).toBeLessThanOrEqual(path.length);
            path = next;
          }
          expect(path).toBe("/");
        },
      ),
    );
  });
});

describe("toApiPath", () => {
  it("根目錄是空字串而不是斜線", () => {
    // 後端會把它接在儲存根後面，"/" 會變成 "//檔名"
    expect(toApiPath("/")).toBe("");
    expect(toApiPath("")).toBe("");
  });

  it("去掉開頭與結尾的斜線", () => {
    expect(toApiPath("/Documents")).toBe("Documents");
    expect(toApiPath("/Documents/")).toBe("Documents");
    expect(toApiPath("//a//")).toBe("a");
  });

  it("中間的分隔符保留", () => {
    expect(toApiPath("/a/b/c")).toBe("a/b/c");
  });

  it("沒有開頭斜線時，中間的分隔符不能被吃掉", () => {
    // ⚠️ 變異測試逼出來的，而且是**這個 codebase 第二次**踩到同一件事
    // （見 features/files/tus-upload.ts 的 normalizeParentPath）：
    // 把 /^\/+/ 的 `^` 錨點拿掉之後，replace（非全域）會替換**第一個**
    // 出現的斜線。有開頭斜線時第一個剛好就是它、結果一樣；沒有的話
    // "a/b" 就變成 "ab"，檔案落到錯的目錄。
    expect(toApiPath("a/b/c")).toBe("a/b/c");
    expect(toApiPath("Documents/2026")).toBe("Documents/2026");
  });
});

describe("pathSegments / pathUpTo", () => {
  it("根目錄沒有麵包屑", () => {
    expect(pathSegments("/")).toEqual([]);
    expect(pathSegments("")).toEqual([]);
  });

  it("空片段會被濾掉", () => {
    // 沒濾的話麵包屑上會出現一個沒有名字、點了會跳到怪路徑的項目
    expect(pathSegments("//a//b/")).toEqual(["a", "b"]);
  });

  it("每一段對應的路徑", () => {
    expect(pathUpTo("/a/b/c", 0)).toBe("/a");
    expect(pathUpTo("/a/b/c", 1)).toBe("/a/b");
    expect(pathUpTo("/a/b/c", 2)).toBe("/a/b/c");
  });

  it("超出範圍就是整條路徑，不會產生怪東西", () => {
    expect(pathUpTo("/a/b", 99)).toBe("/a/b");
    expect(pathUpTo("/a/b", -1)).toBe("/");
  });

  it("性質：最後一段的 pathUpTo 等於原路徑的正規化形式", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("/")),
          { minLength: 1, maxLength: 6 },
        ),
        (segments) => {
          const path = `/${segments.join("/")}`;
          expect(pathUpTo(path, segments.length - 1)).toBe(path);
        },
      ),
    );
  });
});
