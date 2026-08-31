import { expect, test } from "@playwright/test";

import { INVITE_CODE, uniqueUser } from "./helpers";

// 這幾條守的是「整個東西有沒有接起來」——後端 binary 供 SPA、SPA 打得到
// 同源的 API、cookie 在真實瀏覽器裡收得到。這些在 jsdom 的單元測試裡全都
// 是 mock 掉的，所以是完全獨立的一層訊號。

test("未登入時進站看到的是登入畫面", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Username")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
});

test("SPA 的深層路由不會 404（fallback 到 index.html）", async ({ page }) => {
  const res = await page.goto("/some/deep/route/that/only/exists/in/the/spa");

  // 後端要回 index.html 而不是 API 的 404 —— 這是 attach_spa 的 fallback。
  expect(res?.status()).toBe(200);
  expect(res?.headers()["content-type"]).toContain("text/html");

  // 光是 200 還不夠：要確認 bundle 真的跑起來了（router 之後會渲染它自己的
  // notFound，那是應用層的事，跟這裡要驗的 fallback 無關）。
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("不存在的 API 路徑回 404 而不是 index.html", async ({ request }) => {
  // fallback 的另一半：/api 底下不該被 SPA 接走，否則前端會把 HTML 當 JSON 解析
  const res = await request.get("/api/definitely-not-a-real-endpoint");
  expect(res.status()).toBe(404);
  expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
});

test("註冊 → 登入 → 進到桌面", async ({ page }) => {
  const user = uniqueUser();
  await page.goto("/");

  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Username").fill(user);
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByPlaceholder("Confirm Password").fill("password123");
  await page.getByPlaceholder("Invite Code").fill(INVITE_CODE);
  await page.getByPlaceholder("Invite Code").press("Enter");

  // 註冊成功後畫面會切回登入模式並顯示提示
  await expect(page.getByText("Registration successful!")).toBeVisible();

  await page.getByPlaceholder("Username").fill(user);
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByPlaceholder("Password", { exact: true }).press("Enter");

  // 登入後 LoginScreen 會消失（換成桌面或行動版版面）
  await expect(page.getByPlaceholder("Username")).toBeHidden({ timeout: 15_000 });
});

test("錯誤的邀請碼註冊不會成功", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Username").fill(uniqueUser());
  await page.getByPlaceholder("Password", { exact: true }).fill("password123");
  await page.getByPlaceholder("Confirm Password").fill("password123");
  await page.getByPlaceholder("Invite Code").fill("definitely-not-the-code");
  await page.getByPlaceholder("Invite Code").press("Enter");

  await expect(page.getByText("Registration successful!")).toBeHidden();
  await expect(page.getByPlaceholder("Invite Code")).toBeVisible();
});
