import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./helpers";

/**
 * 上傳連結：Finder 工具列建立 → 陌生人在無 cookie 的瀏覽器上傳 → 檔案真的落地。
 *
 * ⚠️ 這條端點**不需要登入**，而且今天才修過兩個洞：數量限制原本在 multipart
 * 迴圈外面只檢查一次（一個請求塞 N 個檔案可以全部繞過），而且是 check-then-act
 * 的競態。後端有整合測試，但「從 UI 建出來的連結真的能用」沒有驗過。
 */
test("從工具列建立上傳連結，陌生人上傳的檔案會落到指定資料夾", async ({ page, browser }) => {
  await registerAndLogin(page, "uplink");
  const folder = `up-${Date.now().toString(36)}`;

  await page.evaluate(async (f: string) => {
    await fetch("/api/files/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "", folder_name: f }),
    });
  }, folder);

  await page.reload();
  await page.getByRole("button", { name: "Finder", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜尋這個資料夾" });
  await search.fill(folder);
  await page.getByText(folder, { exact: true }).first().dblclick({ timeout: 15_000 });
  await search.fill("");

  await page.getByRole("button", { name: "Create Upload Link" }).click();
  await expect(page.getByText("上傳目標資料夾")).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("button", { name: /建立/ })
    .first()
    .click();
  await expect(page.getByText("上傳連結已建立")).toBeVisible({ timeout: 15_000 });

  const url = await page.evaluate(() => {
    const el = [...document.querySelectorAll("input, code, span")].find((n) =>
      (n instanceof HTMLInputElement ? n.value : n.textContent || "").includes("/u/"),
    );
    return el instanceof HTMLInputElement ? el.value : (el?.textContent ?? "");
  });
  const linkId =
    url
      .trim()
      .split("/u/")[1]
      ?.split(/[?#\s]/)[0] ?? "";
  expect(linkId.length, "應該顯示上傳連結網址").toBeGreaterThan(0);

  // ⚠️ 無 cookie 的瀏覽器 —— 這才是「上傳連結」的意思。
  const anonymous = await browser.newContext();
  const guest = await anonymous.newPage();
  await guest.goto(`/u/${linkId}`);
  await expect(guest.getByText(/上傳|Upload/).first()).toBeVisible({ timeout: 15_000 });

  const uploaded = `guest-${Date.now().toString(36)}.txt`;
  const status = await guest.evaluate(
    async ({ id, name }) => {
      const form = new FormData();
      form.append("file", new File(["from a stranger"], name, { type: "text/plain" }));
      const res = await fetch(`/api/upload-link/${id}/upload`, { method: "POST", body: form });
      return res.status;
    },
    { id: linkId, name: uploaded },
  );
  expect(status, "匿名上傳應該成功").toBeLessThan(400);

  await expect
    .poll(
      () =>
        page.evaluate(async (f: string) => {
          const res = await fetch(`/api/files/${f}`);
          if (!res.ok) return [`HTTP ${res.status}`];
          const list = (await res.json()) as { name: string }[];
          return list.map((x) => x.name);
        }, folder),
      { timeout: 25_000 },
    )
    .toContain(uploaded);

  await anonymous.close();
});
