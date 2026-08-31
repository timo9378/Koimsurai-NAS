import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * tus 上傳的端到端驗證。
 *
 * 為什麼要 E2E：後端有 `tus_tests.rs`（協定層），前端有
 * `tus-upload.test.ts`（純函式）。中間那一段 —— 真正的瀏覽器帶著 cookie、
 * 通過 CSRF 檢查、把 `tus-js-client` 的 XHR 送到同源的 `/api/tus` ——
 * 兩邊都測不到。而那正是最容易錯的一段：Origin/Referer、憑證、分塊。
 *
 * 這裡直接在頁面內驅動 `tus-js-client`（透過應用程式打包進去的那一份），
 * 而不是點 UI —— 要驗的是傳輸層，不是檔案選擇器。
 */
test("tus 上傳從瀏覽器到磁碟走得通，而且分塊", async ({ page }) => {
  await registerAndLogin(page, "tus");
  await loadTusClient(page);

  const name = `tus-e2e-${Date.now().toString(36)}.txt`;
  const content = "x".repeat(64 * 1024); // 64 KiB，夠大到看得出進度

  const result = await page.evaluate(
    async ({ name, content }) => {
      const { Upload } = window.tus;
      const file = new File([content], name, { type: "text/plain" });
      const progress: number[] = [];

      return await new Promise<{
        ok: boolean;
        url: string | null;
        progress: number[];
        error?: string;
      }>((resolve) => {
        const upload = new Upload(file, {
          endpoint: "/api/tus",
          chunkSize: 16 * 1024, // 刻意切小，逼出多次 PATCH
          metadata: { filename: name, path: "" },
          onProgress: (sent, total) => progress.push(Math.round((sent / total) * 100)),
          onSuccess: () => resolve({ ok: true, url: upload.url, progress }),
          onError: (e) => resolve({ ok: false, url: null, progress, error: String(e) }),
        });
        upload.start();
      });
    },
    { name, content },
  );

  expect(result.error ?? "", "上傳不該出錯").toBe("");
  expect(result.ok).toBe(true);
  expect(result.url, "伺服器要給回可續傳的 URL").toContain("/api/tus/");

  // 分塊真的發生了 —— 一次傳完的話 onProgress 只會有一筆
  expect(result.progress.length, `進度回報次數：${result.progress.join(",")}`).toBeGreaterThan(1);
  expect(result.progress.at(-1)).toBe(100);

  // 檔案要真的能從 API 讀回來，內容一字不差
  const res = await page.request.get(`/api/download/${encodeURIComponent(name)}`);
  expect(res.status(), "上傳完的檔案應該下載得到").toBe(200);
  expect(await res.text()).toBe(content);
});

test("tus 的 metadata 逃不出儲存根", async ({ page }) => {
  await registerAndLogin(page, "tus_escape");
  await loadTusClient(page);

  const result = await page.evaluate(async () => {
    const { Upload } = window.tus;
    const file = new File(["owned"], "x.txt", { type: "text/plain" });
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const upload = new Upload(file, {
        endpoint: "/api/tus",
        // 客戶端說了算的元資料 —— 後端一定要擋
        metadata: { filename: "../pwned-from-browser.txt", path: "" },
        retryDelays: [], // 別為了這個測試等重試
        onSuccess: () => resolve({ ok: true }),
        onError: (e) => resolve({ ok: false, error: String(e) }),
      });
      upload.start();
    });
  });

  expect(result.ok, "帶著 `..` 的檔名不該上傳成功").toBe(false);
});
