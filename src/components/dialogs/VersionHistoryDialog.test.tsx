import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import type { FileVersion } from "@/types/api";

/**
 * 版本歷史整個功能之前**沒有任何 UI 到得了** —— 後端完整、hook 完整，
 * 右鍵選單那項是個沒有 onClick 的死項目。這支測的是新加的那層。
 */

const version = (id: string, timestamp: number, size: number): FileVersion => ({
  version_id: id,
  timestamp,
  size,
});

function renderDialog(props: Partial<Parameters<typeof VersionHistoryDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onRestore = vi.fn().mockResolvedValue(undefined);
  render(
    <VersionHistoryDialog
      isOpen
      onClose={onClose}
      fileName="報告.pdf"
      versions={[version("1782355562_報告.pdf", 1782355562, 2048)]}
      isLoading={false}
      onRestore={onRestore}
      {...props}
    />,
  );
  return { onClose, onRestore };
}

describe("VersionHistoryDialog", () => {
  it("關著的時候完全不掛載內容", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByText("版本歷史")).not.toBeInTheDocument();
  });

  it("沒有版本時說清楚為什麼是空的", () => {
    renderDialog({ versions: [] });
    expect(screen.getByText(/還沒有舊版本/)).toBeInTheDocument();
  });

  it("undefined 跟空陣列一樣算沒有版本，不會炸掉", () => {
    renderDialog({ versions: undefined });
    expect(screen.getByText(/還沒有舊版本/)).toBeInTheDocument();
  });

  it("載入中不會先顯示「沒有版本」", () => {
    renderDialog({ versions: undefined, isLoading: true });
    expect(screen.queryByText(/還沒有舊版本/)).not.toBeInTheDocument();
  });

  it("列出每個版本的大小", () => {
    renderDialog();
    // formatBytes 會把尾端的 .0 去掉
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("時間戳是 Unix 秒，要乘 1000 才是毫秒", () => {
    // 沒乘 1000 的話會顯示 1970 年 —— 這是最容易靜靜錯掉的一個地方。
    renderDialog({ versions: [version("v", 1782355562, 10)] });
    const expected = new Date(1782355562 * 1000).toLocaleString();
    // 用 textContent 比對：JSX 註解會把 <p> 裡的文字切成多個 text node。
    expect(screen.getByText((_, el) => el?.textContent.trim() === expected)).toBeTruthy();
  });

  it("按下還原會把 version_id 送出去，成功之後關掉 dialog", async () => {
    const user = userEvent.setup();
    const { onClose, onRestore } = renderDialog();

    await user.click(screen.getByRole("button", { name: /還原/ }));

    expect(onRestore).toHaveBeenCalledExactlyOnceWith("1782355562_報告.pdf");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("還原失敗時 dialog 不關 —— 使用者要看得到還有東西沒成功", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockRejectedValue(new Error("boom"));
    const { onClose } = renderDialog({ onRestore });

    await user.click(screen.getByRole("button", { name: /還原/ }));

    expect(onRestore).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("還原進行中時，其他版本的按鈕也要停用（避免併發還原）", async () => {
    const user = userEvent.setup();
    let release = () => {};
    const onRestore = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    renderDialog({
      versions: [version("a", 1782355562, 10), version("b", 1782355000, 20)],
      onRestore,
    });

    const buttons = screen.getAllByRole("button", { name: /還原/ });
    await user.click(buttons[0]!);

    for (const button of screen.getAllByRole("button", { name: /還原/ })) {
      expect(button).toBeDisabled();
    }
    release();
  });
});
