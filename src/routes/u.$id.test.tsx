import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 上傳連結頁的「限制」區塊。
 *
 * ⚠️ 這裡曾經寫成 `{uploadInfo?.max_files && (...)}`。`max_files` 的型別是
 *    `number | null`，而 JSX 的 `{0 && <div/>}` **會在畫面上印出一個 0**
 *    ——不是不渲染。所以「限制 0 個檔案」的連結會在版面上多出一個孤零零的
 *    0，而且外層的 `(a || b) &&` 也會把 0 當成「沒有限制」。
 *
 *    改成 `!= null` 之後兩件事都對了。這支就是把它釘住。
 */

// Route.useParams() 需要 router context。這裡只要讓它回一個 id 就夠了——
// 測的是頁面內容，不是路由本身。
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({
    ...(opts as object),
    useParams: () => ({ id: "test-link" }),
  }),
}));

const { UploadPage } = await import("./u.$id");

interface Info {
  max_files: number | null;
  max_file_size: number | null;
}

/** 讓 /api/upload-link/:id/info 回指定的限制設定。 */
function stubInfo({ max_files, max_file_size }: Info) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: "test-link",
          target_folder: "收件匣",
          is_password_protected: false,
          expires_at: null,
          max_files,
          max_file_size,
          uploaded_count: 0,
          created_at: "2026-08-31T00:00:00Z",
        }),
    }),
  );
}

/** 限制區塊那一整塊的文字（含被誤印出來的裸數字）。 */
async function limitsText() {
  const heading = await screen.findByText(/上傳檔案到/);
  const card = heading.closest("div.min-h-screen") ?? document.body;
  return card.textContent;
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("上傳連結頁的限制顯示", () => {
  it("max_files 為 0 時顯示「0」這個上限，而不是把它當成沒有限制", async () => {
    stubInfo({ max_files: 0, max_file_size: null });
    render(<UploadPage />);

    await waitFor(async () => {
      expect(await limitsText()).toMatch(/檔案數量/);
    });
    expect(await limitsText()).toMatch(/0\s*\/\s*0/);
  });

  it("max_file_size 為 0 時同樣顯示，不會被真假值判斷吃掉", async () => {
    stubInfo({ max_files: null, max_file_size: 0 });
    render(<UploadPage />);

    await waitFor(async () => {
      expect(await limitsText()).toMatch(/單檔限制/);
    });
  });

  it("兩個都是 null（沒有任何限制）時整塊不渲染，也不會留下孤零零的數字", async () => {
    stubInfo({ max_files: null, max_file_size: null });
    render(<UploadPage />);

    await screen.findByText(/上傳檔案到/);
    const text = await limitsText();
    expect(text).not.toMatch(/單檔限制/);
    expect(text).not.toMatch(/檔案數量/);
  });

  it("正常的限制值照常顯示", async () => {
    stubInfo({ max_files: 10, max_file_size: 5 * 1024 * 1024 });
    render(<UploadPage />);

    await waitFor(async () => {
      expect(await limitsText()).toMatch(/單檔限制/);
    });
    const text = await limitsText();
    expect(text).toMatch(/檔案數量/);
    expect(text).toMatch(/0\s*\/\s*10/);
  });
});
