import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// ⚠️ 用 matchMedia 而不是 resize：resize 每動一個 pixel 就觸發一次，
// 而我們只在乎「有沒有跨過 768」。matchMedia 只在跨過時才通知。
const subscribe = (onStoreChange: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
};

const getSnapshot = () => window.matchMedia(QUERY).matches;

/** 目前視窗寬度是否在行動裝置斷點以下。 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
