import { describe, expect, it } from "vitest";
import { clipboardPaths, planPaste, type ClipboardEntry } from "./clipboard";

const copy = (...paths: string[]): ClipboardEntry => ({ mode: "copy", paths });
const cut = (...paths: string[]): ClipboardEntry => ({ mode: "cut", paths });

describe("clipboardPaths", () => {
  it("檔名接上目前目錄，變成絕對路徑", () => {
    expect(clipboardPaths(["a.txt", "b.txt"], "/docs")).toEqual(["/docs/a.txt", "/docs/b.txt"]);
  });

  it("根目錄不會產生雙斜線", () => {
    expect(clipboardPaths(["a.txt"], "/")).toEqual(["/a.txt"]);
  });

  it("重複的檔名只留一份", () => {
    expect(clipboardPaths(["a", "a"], "/")).toEqual(["/a"]);
  });
});

describe("planPaste", () => {
  it("剪貼簿是空的就沒事可做", () => {
    expect(planPaste(null, "/docs")).toEqual({ kind: "noop", reason: "empty" });
    expect(planPaste(copy(), "/docs")).toEqual({ kind: "noop", reason: "empty" });
  });

  it("送出去的是 API 相對路徑，不是絕對路徑", () => {
    expect(planPaste(copy("/docs/a.txt"), "/photos")).toEqual({
      kind: "paste",
      mode: "copy",
      paths: ["docs/a.txt"],
      destination: "photos",
    });
  });

  it("貼到根目錄時 destination 是空字串", () => {
    const plan = planPaste(copy("/docs/a.txt"), "/");
    expect(plan).toMatchObject({ kind: "paste", destination: "" });
  });

  it("不能把資料夾貼進它自己", () => {
    expect(planPaste(copy("/docs"), "/docs")).toEqual({ kind: "noop", reason: "into-self" });
  });

  it("也不能貼進自己底下 —— 複製的話後端會一邊讀一邊往裡面寫", () => {
    expect(planPaste(copy("/docs"), "/docs/inner")).toEqual({
      kind: "noop",
      reason: "into-self",
    });
  });

  it("名字前綴相同但不是子目錄的，要放行", () => {
    // `/docs2` 不在 `/docs` 底下 —— 字串前綴比對會誤判，所以比的是 `/docs/`。
    expect(planPaste(copy("/docs"), "/docs2")).toMatchObject({ kind: "paste" });
  });

  it("剪下到原本的目錄等於沒動作", () => {
    expect(planPaste(cut("/docs/a.txt"), "/docs")).toEqual({ kind: "noop", reason: "same-dir" });
  });

  it("複製到同一個目錄是有效的 —— 後端會產生「名字 (1)」", () => {
    expect(planPaste(copy("/docs/a.txt"), "/docs")).toMatchObject({
      kind: "paste",
      mode: "copy",
      paths: ["docs/a.txt"],
      destination: "docs",
    });
  });

  it("多選時只要有一個貼進自己底下就整批不做", () => {
    // 部分成功會讓使用者搞不清楚到底發生了什麼。
    expect(planPaste(copy("/a.txt", "/docs"), "/docs/inner")).toEqual({
      kind: "noop",
      reason: "into-self",
    });
  });

  it("剪下多個檔案時，只要有一個來自別的目錄就照做", () => {
    expect(planPaste(cut("/docs/a.txt", "/other/b.txt"), "/docs")).toMatchObject({
      kind: "paste",
      mode: "cut",
    });
  });

  it("根目錄的檔案剪下到根目錄也是沒動作", () => {
    expect(planPaste(cut("/a.txt"), "/")).toEqual({ kind: "noop", reason: "same-dir" });
  });
});
