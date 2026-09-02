import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * Finder 的版本歷史。
 *
 * 為什麼挑這個：這個功能今天才接上 UI（後端與 hook 早就完整，但右鍵那項是個
 * 沒有 onClick 的死項目），而 `restore_version` 的路由／handler／utoipa 標註
 * 曾經三處互相矛盾、永遠回 500 並毀掉要還原的那個版本。
 * 元件測試有 9 條，但它是注入式的 —— 「真的抓到版本、真的還原回去」沒驗過。
 */

async function upload(page: Page, name: string, content: string) {
  await loadTusClient(page);
  const ok = await page.evaluate(
    async ({ name, content }) => {
      const file = new File([content], name, { type: "text/plain" });
      return await new Promise<boolean>((resolve) => {
        const up = new window.tus.Upload(file, {
          endpoint: "/api/tus",
          metadata: { filename: name, path: "" },
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
        up.start();
      });
    },
    { name, content },
  );
  expect(ok, `上傳 ${name}`).toBe(true);
}

const contentOf = (page: Page, name: string) =>
  page.evaluate(async (n: string) => {
    const res = await fetch(`/api/download/${encodeURIComponent(n)}`);
    return res.ok ? await res.text() : `HTTP ${res.status}`;
  }, name);

test("覆寫檔案之後看得到舊版本，而且還原得回去", async ({ page }) => {
  await registerAndLogin(page, "ver");
  const name = `v-${Date.now().toString(36)}.txt`;

  await upload(page, name, "第一版");
  await expect.poll(() => contentOf(page, name), { timeout: 20_000 }).toBe("第一版");

  // 同名再傳一次 —— 後端會把舊內容存進 .versions/
  await upload(page, name, "第二版");
  await expect.poll(() => contentOf(page, name), { timeout: 20_000 }).toBe("第二版");

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await selectInFinder(page, name);

  await page.getByText(name, { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Versions", exact: true }).click();

  await expect(page.getByText("版本歷史")).toBeVisible({ timeout: 15_000 });

  // 有一筆舊版本，而且不是「還沒有舊版本」的空狀態。
  const restore = page.getByRole("button", { name: /還原/ });
  await expect(restore.first()).toBeVisible({ timeout: 15_000 });

  await restore.first().click();

  // ⚠️ 還原是非破壞性的：目前內容會先存成新版本，再把選定的版本복回來。
  await expect.poll(() => contentOf(page, name), { timeout: 20_000 }).toBe("第一版");
});
