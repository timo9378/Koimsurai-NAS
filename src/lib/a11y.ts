import type { KeyboardEvent } from "react";

/**
 * 讓 `role="button"` 的元素也能用鍵盤觸發。
 *
 * ⚠️ 什麼時候該用這個、什麼時候該用真的 `<button>`：
 *
 *   優先用 `<button type="button">` —— 焦點、鍵盤、螢幕閱讀器的語意全都是免費的。
 *   只有在 `<button>` 不能用的時候才退到這裡：
 *     1. 裡面還有別的按鈕（HTML 不允許 button 巢狀，瀏覽器會把它拆開，
 *        DOM 變成跟你寫的不一樣）
 *     2. 這個元素同時是拖曳來源（button 的預設行為會跟 drag 打架）
 *
 * 用的時候三件事要一起給，少一件就等於沒做：
 *   `role="button"`、`tabIndex={0}`、`onKeyDown={activateOnKey(handler)}`
 */
export function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    // 空白鍵要 preventDefault，否則會捲動頁面 —— 這是原生 button 幫你做掉的事之一
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  };
}
