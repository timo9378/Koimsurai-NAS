import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunk-plan";
import { buildTusOptions, normalizeParentPath, progressPercent, TUS_ENDPOINT } from "./tus-upload";

describe("normalizeParentPath", () => {
  it("根目錄變成空字串而不是斜線", () => {
    // 後端會把 path 與 filename 接起來，"/" 會產生 "//檔名"
    expect(normalizeParentPath("/")).toBe("");
    expect(normalizeParentPath("")).toBe("");
    expect(normalizeParentPath("///")).toBe("");
  });

  it("去掉開頭的斜線", () => {
    expect(normalizeParentPath("/Documents")).toBe("Documents");
    expect(normalizeParentPath("Documents")).toBe("Documents");
  });

  it("多層路徑保持完整", () => {
    expect(normalizeParentPath("/Documents/2026/報告")).toBe("Documents/2026/報告");
  });

  it("沒有開頭斜線時，中間的分隔符不能被吃掉", () => {
    // ⚠️ 這條是變異測試逼出來的：把 /^\/+/ 的 `^` 錨點拿掉之後，
    // `replace`（非全域）會改成替換**第一個**出現的斜線。有開頭斜線時
    // 第一個剛好就是它，結果一樣；沒有開頭斜線時就會咬掉中間那個，
    // "Documents/2026" 變成 "Documents2026" —— 檔案落到錯的目錄。
    expect(normalizeParentPath("Documents/2026")).toBe("Documents/2026");
    expect(normalizeParentPath("a/b/c")).toBe("a/b/c");
  });

  it("去掉結尾的斜線", () => {
    expect(normalizeParentPath("/Documents/")).toBe("Documents");
  });

  it("連續斜線也處理掉", () => {
    expect(normalizeParentPath("//Documents//")).toBe("Documents");
  });

  it("端點路徑要跟後端的 BASE_PATH 一致", () => {
    // 不一致的話 Location 標頭會指到不存在的位置，而客戶端會安靜地
    // 每次都從頭傳 —— 不會報錯，只是續傳失效
    expect(TUS_ENDPOINT).toBe("/api/tus");
  });
});

describe("progressPercent", () => {
  it("空檔案回 100 而不是 NaN", () => {
    // 0/0 是 NaN，而 NaN 會流進 `width: ${p}%` —— 表現成進度條消失，
    // 不是任何錯誤訊息
    expect(progressPercent(0, 0)).toBe(100);
    expect(progressPercent(0, -1)).toBe(100);
  });

  it("一般情況四捨五入", () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(100, 100)).toBe(100);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
  });

  it("夾在 0–100 之間", () => {
    // 伺服器回報的 offset 比檔案大時（重送、或 offset 記錯）不該顯示 120%
    expect(progressPercent(200, 100)).toBe(100);
    expect(progressPercent(-5, 100)).toBe(0);
  });
});

describe("buildTusOptions", () => {
  const file = new File(["abc"], "報告.txt", { type: "text/plain" });
  const noop = {
    onProgress: () => {},
    onUrl: () => {},
    onSuccess: () => {},
    onError: () => {},
  };

  it("chunkSize 一定是有限值", () => {
    // tus-js-client 預設 Infinity（整份一個請求）—— 那樣斷線就等於從頭來過
    const opts = buildTusOptions(file, "/", noop);
    expect(Number.isFinite(opts.chunkSize)).toBe(true);
    expect(opts.chunkSize).toBe(CHUNK_SIZE);
  });

  it("metadata 帶著檔名與正規化過的父目錄", () => {
    expect(buildTusOptions(file, "/Documents/", noop).metadata).toEqual({
      filename: "報告.txt",
      path: "Documents",
    });
    expect(buildTusOptions(file, "/", noop).metadata).toEqual({
      filename: "報告.txt",
      path: "",
    });
  });

  it("有設定重試，而且第一次是立即重試", () => {
    const delays = buildTusOptions(file, "/", noop).retryDelays;
    expect(delays?.length).toBeGreaterThan(1);
    expect(delays?.[0]).toBe(0);
    // 必須遞增，否則退避沒有意義
    expect(delays).toEqual([...(delays ?? [])].sort((a, b) => a - b));
  });

  it("跨工作階段續傳的兩個開關都開著", () => {
    const opts = buildTusOptions(file, "/", noop);
    expect(opts.storeFingerprintForResuming).toBe(true);
    expect(opts.removeFingerprintOnSuccess).toBe(true);
  });

  it("onProgress 把位元組換算成百分比", () => {
    const seen: number[] = [];
    const opts = buildTusOptions(file, "/", { ...noop, onProgress: (p) => seen.push(p) });
    opts.onProgress?.(25, 100);
    opts.onProgress?.(0, 0);
    expect(seen).toEqual([25, 100]);
  });

  it("onAfterResponse 讀的是 Location 標頭，而且只在有值時回報", () => {
    const urls: string[] = [];
    const asked: string[] = [];
    const opts = buildTusOptions(file, "/", { ...noop, onUrl: (u) => urls.push(u) });
    // ⚠️ 假物件要**記下被問了哪個標頭**。原本寫成 `getHeader: () => loc`
    // 忽略參數，於是把 "Location" 改成別的字串的突變照樣通過 ——
    // 測試等於沒有驗到「讀的是哪一個標頭」。（變異測試抓到的。）
    const res = (loc: string | null) =>
      ({
        getHeader: (name: string) => {
          asked.push(name);
          return name === "Location" ? loc : null;
        },
      }) as unknown as Parameters<NonNullable<typeof opts.onAfterResponse>>[1];

    // ⚠️ onAfterResponse 回的是 Promise —— 這裡不需要等它，但要顯式標明
    void opts.onAfterResponse?.(null as never, res("/api/tus/abc"));
    void opts.onAfterResponse?.(null as never, res(null));
    expect(asked).toEqual(["Location", "Location"]);
    expect(urls).toEqual(["/api/tus/abc"]);
  });

  it("onSuccess 與 onError 真的轉給呼叫端", () => {
    let done = 0;
    const errors: Error[] = [];
    const opts = buildTusOptions(file, "/", {
      ...noop,
      onSuccess: () => {
        done += 1;
      },
      onError: (e) => errors.push(e),
    });

    opts.onSuccess?.({} as never);
    const boom = new Error("boom");
    opts.onError?.(boom);

    expect(done).toBe(1);
    expect(errors).toEqual([boom]);
  });
});
