import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// ⚠️ Node 26 內建了自己的 `localStorage` 全域，而它在沒有 `--localstorage-file`
// 時是停用的（會噴 "localStorage is not available because --localstorage-file
// was not provided"）。因為那個名字已經被佔住，jsdom 的 localStorage 不會蓋上去，
// 於是 `globalThis.localStorage` 是 undefined。
//
// 症狀很難連結到原因：任何用了 zustand `persist` 的 store 一 setState 就丟
// "Cannot read properties of undefined (reading 'setItem')"，而錯誤堆疊指向
// zustand 內部，看不出跟 Node 版本有關。
//
// 這裡直接裝一個記憶體版的。測試本來就不該共用瀏覽器的實體儲存。
class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length() {
    return this.#map.size;
  }
  clear() {
    this.#map.clear();
  }
  getItem(key: string) {
    return this.#map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#map.delete(key);
  }
  setItem(key: string, value: string) {
    this.#map.set(key, String(value));
  }
}

const storage = new MemoryStorage();
for (const target of [globalThis, window]) {
  Object.defineProperty(target, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(target, "sessionStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
}

// jsdom 沒有實作這幾個 —— radix 的 dialog / dropdown 會呼叫它們，不補的話
// 每個測試都會噴 "Not implemented: Window's scrollTo()" 之類的雜訊，把真正
// 的錯誤淹掉。它們對測試的斷言沒有影響，給空實作即可。
const noop = () => undefined;
window.scrollTo = noop;
window.HTMLElement.prototype.scrollIntoView = noop;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.releasePointerCapture = noop;
// useIsMobile 用 matchMedia + useSyncExternalStore。jsdom 的版本不會真的
// 依視窗寬度變化，測試如果要模擬行動裝置，改 stub 這個。
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// 每個測試都從空的儲存開始 —— 否則前一個測試持久化的視窗位置會漏到下一個。
beforeEach(() => {
  storage.clear();
});

// RTL 不會自己清理 —— 少了這行，上一個測試 render 的東西會留在 document 裡，
// 下一個測試的 getByRole 就會抓到兩個而丟 "found multiple elements"。
// 症狀是「單獨跑會過、整包跑會爛」，最難查的那一種。
afterEach(cleanup);
