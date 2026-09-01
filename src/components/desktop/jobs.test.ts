import { describe, expect, it } from "vitest";
import { jobLabel, summarizeJobs } from "./jobs";
import type { Job } from "@/types/api";

const job = (id: string, status: string, created_at: string): Job => ({
  id,
  job_type: "transcode",
  status,
  progress: 0,
  created_at,
  updated_at: created_at,
  error: null,
});

describe("summarizeJobs", () => {
  it("沒有資料時兩邊都是空的，不會炸", () => {
    expect(summarizeJobs(undefined)).toEqual({ active: [], failed: [] });
    expect(summarizeJobs([])).toEqual({ active: [], failed: [] });
  });

  it("排隊中與處理中都算 active", () => {
    const result = summarizeJobs([job("a", "pending", "1"), job("b", "processing", "2")]);
    expect(result.active.map((j) => j.id).sort()).toEqual(["a", "b"]);
  });

  it("已完成的不顯示 —— 它們只會把需要注意的失敗蓋掉", () => {
    const result = summarizeJobs([job("done", "completed", "3"), job("bad", "failed", "2")]);
    expect(result.active).toEqual([]);
    expect(result.failed.map((j) => j.id)).toEqual(["bad"]);
  });

  it("新的排前面", () => {
    const result = summarizeJobs([
      job("old", "failed", "2026-01-01T00:00:00Z"),
      job("new", "failed", "2026-06-01T00:00:00Z"),
    ]);
    expect(result.failed.map((j) => j.id)).toEqual(["new", "old"]);
  });

  it("上限 10 筆 —— 佇列可能有上千筆歷史", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      job(`j${i}`, "failed", `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    expect(summarizeJobs(many).failed).toHaveLength(10);
  });

  it("不會改到傳進來的那份", () => {
    const jobs = [job("a", "failed", "1"), job("b", "failed", "2")];
    summarizeJobs(jobs);
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });
});

describe("jobLabel", () => {
  it("認得的類型翻成中文", () => {
    expect(jobLabel("copy_files")).toBe("複製檔案");
  });

  it("認不得的回原字串，不是「未知」", () => {
    // 後端新增一種工作時，看到 generate_waveform 至少還知道發生了什麼。
    expect(jobLabel("generate_waveform")).toBe("generate_waveform");
  });
});
