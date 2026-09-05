import { expect, test, type Page } from "@playwright/test";

import { loadTusClient, registerAndLogin, selectInFinder } from "./helpers";

/**
 * Finder 的分享對話框。
 *
 * 為什麼挑這個：它牽涉到今天修過的後端 —— `ShareLinkResponse` 的 `expires_at`
 * 手抄型別把 `null` 寫成 `undefined`，而「永不過期」走的正是 `null` 那條路。
 * 純函式測得到對話框的渲染（`ShareDialog` 是注入式的），後端測得到 API，
 * 但「右鍵 → 分享 → 拿到一個真的打得開的連結」中間那段沒人驗過。
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

const listed = (page: Page, name: string) =>
  page.evaluate(async (n: string) => {
    const res = await fetch(`/api/files?search=${encodeURIComponent(n)}&limit=500`);
    const list = (await res.json()) as { name: string }[];
    return list.some((f) => f.name === n);
  }, name);

test("右鍵分享會產生一個陌生人打得開的連結", async ({ page, browser }) => {
  await registerAndLogin(page, "shdlg");
  const name = `sh-${Date.now().toString(36)}.txt`;
  const body = "shared through the dialog";

  await upload(page, name, body);
  await expect.poll(() => listed(page, name), { timeout: 20_000 }).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  await selectInFinder(page, name);

  await page.getByText(name, { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share", exact: true }).click();

  // 對話框先讓你選到期時間／密碼，按下「建立連結」才真的產生。
  await page.getByRole("button", { name: "建立連結" }).click();
  await expect(page.getByText("分享連結已建立")).toBeVisible({ timeout: 15_000 });

  // 對話框裡那個網址要是真的能用的。
  const url = await page.evaluate(() => {
    const el = [...document.querySelectorAll("input, code, span")].find((n) =>
      (n instanceof HTMLInputElement ? n.value : n.textContent || "").includes("/s/"),
    );
    return el instanceof HTMLInputElement ? el.value : (el?.textContent ?? "");
  });
  expect(url, "對話框應該顯示分享網址").toContain("/s/");

  const shareId =
    url
      .trim()
      .split("/s/")[1]
      ?.split(/[?#\s]/)[0] ?? "";
  expect(shareId.length).toBeGreaterThan(0);

  // ⚠️ 用**沒有 cookie 的瀏覽器**開 —— 這才是「分享」的意思。
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(`/s/${shareId}`);
  await expect(guest.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

  const content = await guest.evaluate(async (id: string) => {
    const res = await fetch(`/api/share/${id}/download`);
    return res.ok ? await res.text() : `HTTP ${res.status}`;
  }, shareId);
  expect(content).toBe(body);

  await anonymous.close();
});
