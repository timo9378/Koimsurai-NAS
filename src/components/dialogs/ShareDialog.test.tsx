import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShareDialog } from "./ShareDialog";

/**
 * 這支測的是「重新開啟時狀態要乾淨」。
 *
 * 原本的做法是 `useEffect(() => { if (isOpen) { setStep(...); setPassword(""); ... } })`
 * ——在 effect 裡逐一重設七個欄位。那種寫法有兩個問題：多跑一次 render，
 * 以及日後多一個欄位卻忘了加進重設清單時，不會有任何人發現。
 *
 * 現在改成「只在開啟時掛載 dialog 本體」，每次開啟都是一次全新的 mount，
 * 所有 useState 自動回到初始值。這裡就是把那個保證釘住。
 */

const noopCreate = vi.fn().mockResolvedValue({ id: "x", url: "/s/x", expires_at: null });

function renderDialog(isOpen: boolean) {
  return render(
    <ShareDialog
      isOpen={isOpen}
      onClose={vi.fn()}
      fileName="報告.pdf"
      filePath="/docs/報告.pdf"
      onCreateShare={noopCreate}
    />,
  );
}

describe("ShareDialog", () => {
  it("關閉時完全不掛載內容", () => {
    renderDialog(false);
    expect(screen.queryByText("分享檔案")).not.toBeInTheDocument();
  });

  it("開啟時顯示設定畫面", () => {
    renderDialog(true);
    expect(screen.getByText("分享檔案")).toBeInTheDocument();
  });

  it("關閉再開啟後，上一次輸入的密碼不會留著", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog(true);

    // 打開密碼保護並輸入
    await user.click(screen.getByRole("switch"));
    const input = screen.getByPlaceholderText("輸入分享密碼...");
    await user.type(input, "hunter2");
    expect(input).toHaveValue("hunter2");

    // 關閉
    rerender(
      <ShareDialog
        isOpen={false}
        onClose={vi.fn()}
        fileName="報告.pdf"
        filePath="/docs/報告.pdf"
        onCreateShare={noopCreate}
      />,
    );
    expect(screen.queryByText("分享檔案")).not.toBeInTheDocument();

    // 重新開啟：密碼保護應該是關的，密碼欄不該存在（更不該還留著 hunter2）
    rerender(
      <ShareDialog
        isOpen
        onClose={vi.fn()}
        fileName="報告.pdf"
        filePath="/docs/報告.pdf"
        onCreateShare={noopCreate}
      />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("data-state", "unchecked");
    expect(screen.queryByPlaceholderText("輸入分享密碼...")).not.toBeInTheDocument();
  });

  it("密碼欄的 name 每次開啟都固定，不會每次 render 都變", async () => {
    // ⚠️ 隨機 name 是為了擋 Chrome 的密碼自動填入。原本用 `${Date.now()}`
    //    ——那是在 render 中做有副作用的呼叫，每次 render 都是不同的值。
    //    現在用 useId()，一次算好、整個生命週期不變。
    const user = userEvent.setup();
    renderDialog(true);
    await user.click(screen.getByRole("switch"));

    const input = screen.getByPlaceholderText("輸入分享密碼...");
    const nameBefore = input.getAttribute("name");
    expect(nameBefore).toBeTruthy();

    // 打字會觸發 re-render
    await user.type(input, "abc");
    expect(screen.getByPlaceholderText("輸入分享密碼...")).toHaveAttribute("name", nameBefore!);
  });
});
