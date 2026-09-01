import type { Job } from "@/types/api";

/**
 * 背景工作清單要顯示什麼。
 *
 * ⚠️ 這些工作原本**完全看不到** —— `useTasks` 是零呼叫點。轉檔、產縮圖、
 * 複製檔案都是丟進佇列跑的，失敗了使用者不會知道，只會覺得「東西沒出現」。
 *
 * 已完成的不顯示：它們沒有任何要處理的東西，只會把真正需要注意的失敗蓋掉。
 */
export interface JobSummary {
  /** 正在跑或排隊中，依建立時間新到舊 */
  readonly active: Job[];
  /** 失敗的，依建立時間新到舊 */
  readonly failed: Job[];
}

/** 一次最多列幾筆 —— 佇列可能有上千筆歷史，面板不是 log viewer。 */
const LIMIT = 10;

export function summarizeJobs(jobs: readonly Job[] | undefined): JobSummary {
  if (!jobs) return { active: [], failed: [] };

  const byNewest = [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    active: byNewest
      .filter((j) => j.status === "pending" || j.status === "processing")
      .slice(0, LIMIT),
    failed: byNewest.filter((j) => j.status === "failed").slice(0, LIMIT),
  };
}

const LABELS: Record<string, string> = {
  transcode: "轉檔",
  generate_thumbnail: "產生縮圖",
  generate_video_proxy: "產生預覽影片",
  generate_hls: "產生串流",
  copy_files: "複製檔案",
  index_file: "建立索引",
  ai_analyze_image: "分析圖片",
};

/**
 * 工作類型的顯示名稱。
 *
 * 認不得的類型回傳原字串而不是「未知」—— 後端新增一種工作時，看到
 * `generate_waveform` 至少還知道發生了什麼，看到「未知」則什麼都不知道。
 */
export function jobLabel(jobType: string): string {
  return LABELS[jobType] ?? jobType;
}
