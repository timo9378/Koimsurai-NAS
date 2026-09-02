import { expect, test } from "@playwright/test";

import { registerAndLogin, totpCode } from "./helpers";

/**
 * 開啟兩步驟驗證的完整流程，以及它對 WebDAV 的影響。
 *
 * `Settings.tsx` 有 813 行、覆蓋率 0%，而 2FA 是其中風險最高的一段：設定錯了
 * 使用者會**把自己鎖在外面**。純函式測不到「掃了 QR、輸入 code、真的啟用了」。
 *
 * 而且它跨了兩個功能：開啟 2FA 之後 WebDAV 會直接停止運作（Basic 認證沒有
 * 輸入第二因素的地方）。那個因果只有端到端測得到 —— 前端顯示的警告與後端
 * 實際的拒絕是兩份獨立的實作，各自對了不代表兩邊一致。
 */
test("開啟 2FA 之後，WebDAV 會被拒絕，而設定裡也說得出原因", async ({ page }) => {
  const username = await registerAndLogin(page, "twofa");

  // WebDAV 在開啟 2FA **之前**是可以用的 —— 先確立這個基準，
  // 不然後面的 401 可能只是因為密碼本來就不對。
  const davStatus = (user: string, pwd: string) =>
    page.evaluate(
      async ({ user, pwd }) => {
        const res = await fetch("/webdav/", {
          method: "PROPFIND",
          headers: {
            Authorization: `Basic ${btoa(`${user}:${pwd}`)}`,
            Depth: "0",
          },
        });
        return res.status;
      },
      { user, pwd },
    );
  expect(await davStatus(username, "password123"), "開 2FA 前 WebDAV 應該可用").toBeLessThan(400);

  // ── 開啟 2FA ────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "" }).first().click();
  await page.getByRole("menuitem", { name: /系統設定/ }).click();
  await page.getByRole("button", { name: "安全性", exact: true }).click();

  // 啟用之前就要看得到「WebDAV 會停止運作」的警告。
  await expect(page.getByText(/WebDAV 會停止運作/)).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("button", { name: /啟用/ })
    .first()
    .click();

  const secret = await page.getByTestId("totp-secret").innerText({ timeout: 15_000 });
  expect(secret.length, "應該顯示 base32 密鑰").toBeGreaterThan(10);

  await page.getByRole("textbox", { name: "驗證器顯示的 6 位數字" }).fill(totpCode(secret));
  await page.getByRole("button", { name: "驗證並啟用" }).click();

  // 啟用成功會給 backup codes —— 那是唯一一次看得到它們的機會。
  await expect(page.getByText(/backup/i).first()).toBeVisible({ timeout: 15_000 });

  // ── 後端真的拒絕 WebDAV 了 ───────────────────────────────────────────────
  expect(await davStatus(username, "password123"), "開了 2FA 之後 WebDAV 必須被拒絕").toBe(401);

  // ── 設定裡說得出原因 ────────────────────────────────────────────────────
  await page.getByRole("button", { name: "WebDAV", exact: true }).click();
  await expect(page.getByText(/這個帳號目前用不了 WebDAV/)).toBeVisible({ timeout: 15_000 });
});
