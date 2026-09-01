// 極簡 service worker：讓 App 可安裝成 PWA。
// 刻意「不做離線快取」——這是動態 NAS/監控 app，快取靜態資源反而會造成內容過期。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // pass-through：不呼叫 respondWith，交給瀏覽器預設網路處理。
  // 有註冊 fetch handler 即可滿足 Chrome 的可安裝性要求。
});
