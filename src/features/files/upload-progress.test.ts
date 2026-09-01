import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { overallProgress } from "./upload-progress";
import type { UploadTask } from "@/store/upload-store";

// File.size 是唯讀的，而測試不想真的配置 4GB，所以直接蓋掉那個屬性。
const sized = (size: number, progress: number): UploadTask => {
  const file = new File([], "x");
  Object.defineProperty(file, "size", { value: size });
  return { id: `t${size}-${progress}`, file, path: "/", progress, status: "uploading" };
};

describe("overallProgress", () => {
  it("沒有任務就是 0", () => {
    expect(overallProgress([])).toBe(0);
  });

  it("小檔傳完不會讓進度條假裝跑了一半", () => {
    // 4GB 完全沒動 + 2KB 傳完。平均法會給 50%。
    const tasks = [sized(4 * 1024 ** 3, 0), sized(2048, 100)];
    expect(overallProgress(tasks)).toBe(0);
  });

  it("單一任務就是它自己的進度", () => {
    expect(overallProgress([sized(1000, 37)])).toBe(37);
  });

  it("同樣大小時就是平均", () => {
    expect(overallProgress([sized(100, 20), sized(100, 80)])).toBe(50);
  });

  it("全部是空檔時退回件數平均，而不是 NaN", () => {
    expect(overallProgress([sized(0, 0), sized(0, 100)])).toBe(50);
  });

  it("永遠落在 0 到 100 之間", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            size: fc.integer({ min: 0, max: 2 ** 40 }),
            progress: fc.integer({ min: 0, max: 100 }),
          }),
          { maxLength: 20 },
        ),
        (specs) => {
          const value = overallProgress(specs.map((s) => sized(s.size, s.progress)));
          return Number.isInteger(value) && value >= 0 && value <= 100;
        },
      ),
    );
  });
});
