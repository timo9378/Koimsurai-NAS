'use client';

import { useEffect } from 'react';

/** 在瀏覽器端註冊 /sw.js，讓網站可被「加到主畫面」安裝成 PWA。 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
