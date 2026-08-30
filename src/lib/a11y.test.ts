import { describe, expect, it, vi } from "vitest";
import { activateOnKey } from "./a11y";

/**
 * `role="button"` 的元素沒有原生鍵盤行為，這支就是那層補丁。
 * 測的重點是「哪些鍵該觸發、哪些不該」以及空白鍵的 preventDefault——
 * 少了後者，用空白鍵按 Dock 的視窗預覽會順便把頁面往下捲。
 */

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe("activateOnKey", () => {
  it.each(["Enter", " "])("%s 會觸發 handler", (key) => {
    const handler = vi.fn();
    const e = keyEvent(key);
    activateOnKey(handler)(e);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("空白鍵一定要 preventDefault，否則會捲動頁面", () => {
    const e = keyEvent(" ");
    activateOnKey(vi.fn())(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(["Tab", "Escape", "a", "ArrowDown", "Spacebar"])("%s 不會觸發，也不攔預設行為", (key) => {
    const handler = vi.fn();
    const e = keyEvent(key);
    activateOnKey(handler)(e);
    expect(handler).not.toHaveBeenCalled();
    // ⚠️ Tab 特別重要：攔下來就等於把焦點鎖在這個元素上，鍵盤使用者出不去。
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
