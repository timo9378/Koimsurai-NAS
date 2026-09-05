import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * 上傳期間不可以在檔案列表裡看到暫存檔。
 *
 * ⚠️ 這是我自己引入又修掉的問題。為了讓落地變成原子的，tus 與上傳連結都改成
 * 「先寫同目錄的暫存檔、再 rename」。但暫存檔原本叫 `foo.bin.tus-<id>.partial`
 * —— **不是**以點開頭，而索引器的 watcher 只跳過以點開頭的名字。於是大檔案
 * 上傳期間那個暫存檔會被索引進 files 表，使用者在 Finder 裡看到一個奇怪的
 * `.partial` 項目。
 *
 * 為什麼小檔案測不出來：watcher 有 500ms 的 debounce，而小檔案從建立到 rename
 * 在那個窗口內就結束了 —— 6MB 完全看不到，160MB 一定看得到。
 * 這條刻意用大檔案。
 */
test("大檔案上傳期間，列表裡不會出現暫存檔", async ({ page }) => {
  test.slow();
  await registerAndLogin(page, "artifacts");
  await loadTusClient(page);

  const name = `big-${Date.now().toString(36)}.bin`;
  const seen = new Set<string>();

  // 一邊上傳一邊輪詢列表 —— 暫存檔只在上傳期間存在，事後查是查不到的。
  const poll = setInterval(() => {
    void page
      .evaluate(async (n: string) => {
        // 用 `search` 限縮：`/api/files` 預設 limit=50，而儲存根是共用的。
        // 這裡要找的暫存檔名一定含著上傳檔名（`.{name}.tus-….partial`），
        // 所以照名字搜尋不會漏掉它。
        const res = await fetch(`/api/files?search=${encodeURIComponent(n)}&limit=500`);
        return ((await res.json()) as { name: string }[]).map((f) => f.name);
      }, name)
      .then((names) => {
        for (const n of names) seen.add(n);
      })
      .catch(() => {
        /* 上傳期間偶爾抓不到，忽略 */
      });
  }, 300);

  const ok = await page.evaluate(async (n: string) => {
    const file = new File([new Uint8Array(160 * 1024 * 1024)], n, {
      type: "application/octet-stream",
    });
    return await new Promise<boolean>((resolve) => {
      const up = new window.tus.Upload(file, {
        endpoint: "/api/tus",
        chunkSize: 8 * 1024 * 1024,
        metadata: { filename: n, path: "" },
        onSuccess: () => resolve(true),
        onError: () => resolve(false),
      });
      up.start();
    });
  }, name);
  expect(ok, "上傳應該成功").toBe(true);

  await page.waitForTimeout(2500);
  clearInterval(poll);

  const artifacts = [...seen].filter(
    (n) => n.includes(".partial") || n.includes(".part-") || n.includes(".tus-"),
  );
  expect(artifacts, "列表裡不該出現任何暫存檔").toEqual([]);

  // 而且檔案本身要真的落地。
  const landed = await page.evaluate(async (n: string) => {
    const res = await fetch(`/api/files?search=${encodeURIComponent(n)}&limit=500`);
    return ((await res.json()) as { name: string }[]).some((f) => f.name === n);
  }, name);
  expect(landed, "檔案本身要出現在列表裡").toBe(true);
});
