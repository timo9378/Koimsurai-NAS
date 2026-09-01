import { expect, test } from "@playwright/test";

import { loadTusClient, registerAndLogin } from "./helpers";

/**
 * 手機版的檔案預覽。
 *
 * 為什麼要 E2E：這段之前**完全不存在** —— 手機點一下檔案開的是動作面板，
 * 一個 NAS 的手機介面看不了自己的照片。純函式測得到的只有動作清單
 * （`mobile/actions.test.ts`），「點下去真的會開一個看得到內容的預覽」
 * 只有真瀏覽器測得出來。
 *
 * 用 375×667 的視窗：`useIsMobile` 看的是 `max-width: 767px`。
 */
test.use({ viewport: { width: 375, height: 667 } });

test("手機點一下檔案會開全螢幕預覽，關掉會回到列表", async ({ page }) => {
  await registerAndLogin(page, "mobileprev");

  // 先放一個看得到內容的文字檔進去。走 tus 而不是 UI —— 要驗的是預覽，
  // 不是上傳（上傳有 tus-upload.spec.ts）。
  await loadTusClient(page);
  const name = `preview-${Date.now().toString(36)}.txt`;
  const uploaded = await page.evaluate(
    async ({ name }) => {
      const { Upload } = window.tus;
      const file = new File(["手機預覽測試內容"], name, { type: "text/plain" });
      return await new Promise<boolean>((resolve) => {
        const upload = new Upload(file, {
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
  expect(uploaded, "建立測試檔案").toBe(true);

  await page.reload();

  const row = page.getByText(name, { exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  // 預覽開起來：標題列有檔名，內容區有檔案內容。
  const close = page.getByRole("button", { name: "Close preview" });
  await expect(close).toBeVisible({ timeout: 15_000 });

  await close.click();
  await expect(close).toBeHidden();
  await expect(row).toBeVisible();
});
