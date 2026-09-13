import { expect, test } from "@playwright/test";

import { isListed, registerAndLogin } from "./helpers";

/**
 * 0 bytes 的上傳不可以假裝成功。
 *
 * 真實事件（2026-09-08）：瀏覽器把 11 支 GoPro 影片讀成 0 bytes，上傳面板全部給綠勾，
 * 其中兩支到最後都沒有好的副本 —— 使用者直到五天後才從 log 裡知道。
 *
 * 這也是**第一條**真的透過 Finder 的檔案選擇器上傳的 E2E。其他上傳測試都在
 * `page.evaluate` 裡直接呼叫 tus，那條路完全不經過 `useFileUpload` 與上傳面板。
 *
 * ⚠️ 同一批刻意放一個非空檔案當對照組。只驗「空檔案有警告」的話，
 * 把所有完成都畫成警告也會綠 —— 那樣測到的不是「區分」。
 */
test("0 bytes 的上傳顯示警告而不是綠勾，而且清除已完成時不會被一起清掉", async ({ page }) => {
  await registerAndLogin(page, "emptyup");

  await page.getByRole("button", { name: "Finder", exact: true }).click();
  // Finder 裡那個隱藏的 <input type="file">。桌面右鍵選單也有一個，所以要限定在視窗內。
  const input = page.locator('[data-window-frame] input[type="file"]');
  await expect(input).toBeAttached({ timeout: 15_000 });

  const stamp = Date.now().toString(36);
  const empty = `empty-${stamp}.txt`;
  const normal = `normal-${stamp}.txt`;

  await input.setInputFiles([
    { name: empty, mimeType: "text/plain", buffer: Buffer.alloc(0) },
    { name: normal, mimeType: "text/plain", buffer: Buffer.from("有內容") },
  ]);

  const emptyRow = page.locator(`[data-upload-name="${empty}"]`);
  const normalRow = page.locator(`[data-upload-name="${normal}"]`);

  await expect(normalRow).toHaveAttribute("data-upload-status", "completed", { timeout: 20_000 });
  await expect(emptyRow).toHaveAttribute("data-upload-status", "warning", { timeout: 20_000 });
  await expect(emptyRow).toContainText("0 bytes");
  await expect(normalRow).not.toContainText("0 bytes");

  // 批次上傳之後最可能做的事就是按清除 —— 警告跟著被清掉，就又回到「不會知道」。
  // ⚠️ exact: true 不能省。標題列本身是 role="button" 的 div、而且包著這顆按鈕，
  // 它的可讀名稱會把子元素的 aria-label 串進去 —— 預設的子字串比對會同時命中兩個。
  await page.getByRole("button", { name: "清除已完成", exact: true }).click();
  await expect(normalRow).toHaveCount(0);
  await expect(emptyRow).toBeVisible();
});

test.describe("手機版", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  // 手機版本來就**不顯示已完成的任務**。只修桌面版的話，手機上 0 bytes 仍是完全靜默的。
  test("0 bytes 的上傳在手機上也看得到警告，而且正常完成的不會被一起帶出來", async ({ page }) => {
    await registerAndLogin(page, "emptyupm");

    // ⚠️ 先斷言頁面上**只有一個** file input（右下角 FAB 那個）。多一個的話
    // setInputFiles 可能打到別的元件，測到的就不是手機版的上傳路徑。
    const input = page.locator('input[type="file"]');
    await expect(input).toHaveCount(1, { timeout: 15_000 });

    const stamp = Date.now().toString(36);
    const empty = `empty-m-${stamp}.txt`;
    const normal = `normal-m-${stamp}.txt`;
    await input.setInputFiles([
      { name: empty, mimeType: "text/plain", buffer: Buffer.alloc(0) },
      { name: normal, mimeType: "text/plain", buffer: Buffer.from("有內容") },
    ]);

    const emptyRow = page.locator(`[data-upload-name="${empty}"]`);
    await expect(emptyRow).toHaveAttribute("data-upload-status", "warning", { timeout: 20_000 });
    await expect(emptyRow).toContainText("0 bytes");

    // ⚠️ 要等正常那個**真的傳完**才斷言它沒有橫幅。上傳中本來就不會出現在這裡，
    // 太早檢查的話「沒有」是必然的 —— 那條斷言會是空的。
    await expect.poll(() => isListed(page, normal), { timeout: 20_000 }).toBe(true);
    await expect(page.locator(`[data-upload-name="${normal}"]`)).toHaveCount(0);

    await page.getByRole("button", { name: `Dismiss upload warning for ${empty}` }).click();
    await expect(emptyRow).toHaveCount(0);
  });
});
