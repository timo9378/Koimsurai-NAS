"use client";

import { useEffect } from "react";

/** 在瀏覽器端註冊 /sw.js，讓網站可被「加到主畫面」安裝成 PWA。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e: unknown) => {
        // 註冊失敗不影響網站運作（只是不能安裝成 PWA），但完全吞掉的話
        // 連「為什麼裝不起來」都查不到。
        console.warn("Service worker 註冊失敗", e);
      });
    }
  }, []);
  return null;
}
