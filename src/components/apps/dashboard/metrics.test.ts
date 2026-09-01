import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { diskDisplayName, diskTotals, progressColor, usagePercent } from "./metrics";
import type { DiskInfo } from "@/types/api";

const disk = (total: number, available: number): DiskInfo => ({
  name: "sda",
  mount_point: "/data",
  disk_type: "SSD",
  total_space: total,
  available_space: available,
});

describe("usagePercent", () => {
  it("一般情況", () => {
    expect(usagePercent(50, 200)).toBe(25);
  });

  it("total 是 0 時回 0，不是 NaN", () => {
    // 這正是原本記憶體那條缺的守衛 —— 畫面上會出現「NaN%」，
    // 進度條的 width 也會變成 `NaN%`。
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(5, 0)).toBe(0);
  });

  it("缺值回 0", () => {
    expect(usagePercent(undefined, 100)).toBe(0);
    expect(usagePercent(50, undefined)).toBe(0);
    expect(usagePercent(null, null)).toBe(0);
  });

  it("負的 total 也當成沒有", () => {
    expect(usagePercent(5, -1)).toBe(0);
  });

  it("永遠是有限的數字", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 40 }),
        fc.integer({ min: 0, max: 2 ** 40 }),
        (used, total) => Number.isFinite(usagePercent(used, total)),
      ),
    );
  });
});

describe("diskTotals", () => {
  it("沒有磁碟時不會除以零", () => {
    expect(diskTotals([])).toEqual({ used: 0, size: 0, percent: 0 });
    expect(diskTotals(undefined)).toEqual({ used: 0, size: 0, percent: 0 });
  });

  it("used 是 total - available，不是某個欄位", () => {
    expect(diskTotals([disk(100, 40)])).toEqual({ used: 60, size: 100, percent: 60 });
  });

  it("多顆磁碟加總", () => {
    const { used, size } = diskTotals([disk(100, 40), disk(200, 100)]);
    expect({ used, size }).toEqual({ used: 160, size: 300 });
  });
});

describe("progressColor", () => {
  it("剛好 90 還不算危險 —— 門檻是 > 不是 >=", () => {
    expect(progressColor(90)).toBe(progressColor(80));
    expect(progressColor(90.1)).toContain("red");
  });

  it("剛好 75 還不算警告", () => {
    expect(progressColor(75)).toContain("emerald");
    expect(progressColor(75.1)).toContain("amber");
  });

  it("0 與 100 都有顏色", () => {
    expect(progressColor(0)).toContain("emerald");
    expect(progressColor(100)).toContain("red");
  });
});

describe("diskDisplayName", () => {
  it("根目錄叫 System", () => {
    expect(diskDisplayName({ name: "sda1", mount_point: "/", disk_type: "SSD" })).toEqual({
      name: "System",
      subtitle: "SSD",
    });
  });

  it("其餘取掛載點的最後一段", () => {
    expect(
      diskDisplayName({ name: "sdb1", mount_point: "/mnt/hdd16tb_01", disk_type: "HDD" }).name,
    ).toBe("hdd16tb_01");
  });

  it("掛載點只有斜線以外的怪值時退回裝置名", () => {
    expect(diskDisplayName({ name: "sdc1", mount_point: "///", disk_type: "HDD" }).name).toBe(
      "sdc1",
    );
  });
});
