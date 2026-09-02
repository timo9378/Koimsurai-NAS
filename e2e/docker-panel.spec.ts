import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * Docker 面板的狀態。
 *
 * ⚠️ 這個面板原本只有 `isLoading ? "Loading…" : <清單>` —— 「這個帳號沒有
 * Docker 管理權限」「連不上 Docker」「真的沒有容器」三種完全不同的狀況長得
 * 一模一樣，都是一片空白。而 production 的 `DOCKER_MANAGER_USER_IDS=1,2`
 * 表示第三個帳號打開它就是永遠空白（而且每 3 秒重打一次 403）。
 *
 * E2E 環境沒有開 Docker 管理，所以這裡走到的是「連不上／沒有權限」那條 ——
 * 重點是它**說得出原因**，而不是留一片空白。
 */
test("沒有 Docker 時面板會說明原因，不是一片空白", async ({ page }) => {
  await registerAndLogin(page, "dockerpanel");

  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await expect(page.locator("[data-window-frame]").first()).toBeVisible({ timeout: 15_000 });

  // 三種可能的說明，至少要出現一種 —— 不能什麼都不說。
  const explained = page.getByText(/沒有 Docker 管理權限|連不上 Docker|讀取失敗|沒有containers/);
  await expect(explained.first()).toBeVisible({ timeout: 20_000 });
});
