import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * Photos 的時間軸。
 *
 * 為什麼要 E2E：這支 app **從來沒有顯示過任何東西**。它自己寫的 useQuery 打的是
 * `/api/media/timeline`，而 apiClient 的 baseURL 就是 `/api` —— 實際請求是
 * `/api/api/media/timeline`，永遠 404。而且它手抄的型別把欄位寫成 `items`，
 * 後端送的是 `files`，所以就算網址對了也會炸在 `group.items.length`。
 *
 * 兩個 bug 都只有「真的把 app 打開來看」才發現得了：型別檢查過得去（手抄的那份
 * 自洽）、單元測試沒有、而 404 被 react-query 靜靜吞掉變成一片空白。
 */
test("Photos 顯示得出上傳的圖片", async ({ page }) => {
  await registerAndLogin(page, "photos");
  await loadTusClient(page);

  // 1×1 的透明 PNG。要是真的圖片，indexer 才會給它 image/ 的 mime type，
  // 而時間軸只挑 image/% 與 video/%。
  const name = `photo-${Date.now().toString(36)}.png`;
  const uploaded = await page.evaluate(
    async ({ name }) => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: "image/png" });

      return await new Promise<boolean>((resolve) => {
        const upload = new window.tus.Upload(file, {
          endpoint: "/api/tus",
          metadata: { filename: name, path: "" },
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
        upload.start();
      });
    },
    { name },
  );
  expect(uploaded, "上傳圖片").toBe(true);

  // 等 indexer 把它寫進 files 表，時間軸是查 DB 的。
  await expect
    .poll(
      () =>
        page.evaluate(async (n: string) => {
          const res = await fetch("/api/media/timeline?group_by=day");
          if (!res.ok) return false;
          const groups = (await res.json()) as { files: { name: string }[] }[];
          return groups.some((g) => g.files.some((f) => f.name === n));
        }, name),
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Photos", exact: true }).click();

  // 標題渲染得出來就代表 `group.files` 讀到了（讀 `items` 會是 undefined）。
  await expect(page.getByRole("button", { name: `預覽 ${name}` })).toBeVisible({
    timeout: 15_000,
  });
});
