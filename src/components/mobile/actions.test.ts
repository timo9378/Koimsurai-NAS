import { describe, expect, it } from "vitest";
import { sheetActions } from "./actions";

const ids = (file: { is_dir: boolean; is_starred: boolean }, isTrash = false) =>
  sheetActions(file, isTrash).map((a) => a.id);

const FILE = { is_dir: false, is_starred: false };
const FOLDER = { is_dir: true, is_starred: false };

describe("sheetActions", () => {
  it("資料夾不提供下載 —— 後端要求 is_file()，資料夾一律 404", () => {
    expect(ids(FOLDER)).not.toContain("download");
    expect(ids(FILE)).toContain("download");
  });

  it("星號是二選一，不會同時出現", () => {
    expect(ids(FILE)).toContain("star");
    expect(ids(FILE)).not.toContain("unstar");
    expect(ids({ ...FILE, is_starred: true })).toContain("unstar");
    expect(ids({ ...FILE, is_starred: true })).not.toContain("star");
  });

  it("垃圾桶裡只有還原與永久刪除", () => {
    expect(ids(FILE, true)).toEqual(["restore", "delete-permanent"]);
    // 垃圾桶用的是扁平檔名，這些操作的路徑根本對不上。
    expect(ids(FOLDER, true)).toEqual(["restore", "delete-permanent"]);
  });

  it("破壞性的項目要標成 danger", () => {
    const danger = (file: typeof FILE, isTrash: boolean) =>
      sheetActions(file, isTrash)
        .filter((a) => a.danger)
        .map((a) => a.id);
    expect(danger(FILE, false)).toEqual(["delete"]);
    expect(danger(FILE, true)).toEqual(["delete-permanent"]);
  });

  it("id 不重複 —— handleAction 是靠 id 分支的", () => {
    for (const isTrash of [false, true]) {
      for (const file of [FILE, FOLDER, { ...FILE, is_starred: true }]) {
        const list = ids(file, isTrash);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it("每個項目都有非空的 label 與圖示", () => {
    for (const action of [...sheetActions(FILE, false), ...sheetActions(FILE, true)]) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.icon).toBeTruthy();
    }
  });
});
