import { describe, expect, it } from "vitest";
import { filterTimeline, flattenTimeline } from "./timeline";
import type { FileInfo, TimelineGroup } from "@/types/api";

const file = (name: string): FileInfo => ({
  name,
  path: `/photos/${name}`,
  is_dir: false,
  size: 1,
  modified: "0",
  tags: [],
  mime_type: "image/jpeg",
  metadata: null,
  is_starred: false,
});

const group = (date: string, names: string[]): TimelineGroup => ({
  date,
  files: names.map(file),
});

describe("flattenTimeline", () => {
  it("每一組先出標題，再切成每列 6 張", () => {
    const rows = flattenTimeline([group("2026-01-01", ["a", "b", "c", "d", "e", "f", "g"])]);
    expect(rows.map((r) => r.type)).toEqual(["header", "row", "row"]);
    expect((rows[1] as { items: FileInfo[] }).items).toHaveLength(6);
    expect((rows[2] as { items: FileInfo[] }).items).toHaveLength(1);
  });

  it("標題的數量是整組的張數，不是某一列的", () => {
    const rows = flattenTimeline([group("2026-01-01", ["a", "b", "c", "d", "e", "f", "g"])]);
    expect(rows[0]).toEqual({ type: "header", date: "2026-01-01", count: 7 });
  });

  it("空的分組不產生標題 —— 不然會看到一堆空日期", () => {
    expect(flattenTimeline([group("2026-01-01", [])])).toEqual([]);
  });

  it("多組會依序接起來", () => {
    const rows = flattenTimeline([group("2026-01-02", ["a"]), group("2026-01-01", ["b"])]);
    expect(rows.map((r) => (r.type === "header" ? r.date : "row"))).toEqual([
      "2026-01-02",
      "row",
      "2026-01-01",
      "row",
    ]);
  });

  it("每列張數可以換，剛好整除時不會多出空列", () => {
    const rows = flattenTimeline([group("d", ["a", "b", "c", "d"])], 2);
    expect(rows.filter((r) => r.type === "row")).toHaveLength(2);
  });
});

describe("filterTimeline", () => {
  it("空字串不過濾", () => {
    const timeline = [group("d", ["a.jpg", "b.png"])];
    expect(filterTimeline(timeline, "")).toEqual(timeline);
    expect(filterTimeline(timeline, "   ")).toEqual(timeline);
  });

  it("依檔名過濾，大小寫不分", () => {
    const result = filterTimeline([group("d", ["Sunset.JPG", "cat.png"])], "sunset");
    expect(result[0]?.files.map((f) => f.name)).toEqual(["Sunset.JPG"]);
  });

  it("整組被濾光就連日期一起拿掉", () => {
    expect(filterTimeline([group("d", ["cat.png"])], "dog")).toEqual([]);
  });

  it("不會改到傳進來的那份", () => {
    const timeline = [group("d", ["a.jpg", "b.png"])];
    filterTimeline(timeline, "a");
    expect(timeline[0]?.files).toHaveLength(2);
  });
});
