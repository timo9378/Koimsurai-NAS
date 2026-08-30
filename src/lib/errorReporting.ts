// 前端錯誤上報 → 自架 GlitchTip（Sentry SDK 相容）。
//
// 用業界標準的 SDK（錯誤捕捉要處理 source map、unhandledrejection、跨瀏覽器
// stack 格式，自己寫不划算），但**資料送自己家**。
//
// ## 為什麼走 /api/_report 而不是直連
//
// SDK 的 `tunnel` 選項把 envelope POST 到指定網址而不是上報端點。三個理由：
//   1. 真正的 DSN 不進 bundle（見下方說明）
//   2. 擋廣告外掛不會誤殺 —— uBlock 那類用通用規則比對 `/envelope/`、
//      `/api/N/store/` 這種路徑，而被擋時是**靜默的**：這裡以為送出去了，
//      你以為沒出錯
//   3. GlitchTip 的 ingest 端點不必對這個站開
//
// ## VITE_SENTRY_DSN 裡那把 key 是假的
//
// SDK 在 tunnel 模式下仍然需要一個 DSN（它會塞進 envelope header），所以那把 key
// 一定會出現在 bundle 裡 —— 這是設計如此，躲不掉。
// 後端只認網址上的 `?sentry_key=`、不驗 envelope 裡的 dsn 欄位，所以這裡放的是
// 一把隨機產的假 key，轉發時才換成真的（backend/src/handlers/report_tunnel.rs
// 的 SENTRY_TUNNEL_PUBLIC_KEY）。結果是：bundle 裡那把 key 只對「那個有速率
// 限制的自家端點」有效。

let started = false;

export async function initErrorReporting(): Promise<void> {
  if (started) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  // 沒設就整個不啟用（本機開發的預設狀態）。
  // 也不要「先動態載入再判斷」—— 那是白付一次網路。
  if (!dsn) return;
  started = true;

  // ⚠️ 一定要**具名解構**，不能寫成 `const Sentry = await import(...)`。
  //   namespace import 讓 bundler 無法證明哪些 export 用得到（理論上可以動態存取），
  //   於是整包留著 —— Replay(rrweb) + Feedback + browserTracing 全部進 bundle。
  //   sora-to-ki 實測差距（gzip 後）：namespace **135 KB** → 具名解構 **26 KB**。
  const { init } = await import("@sentry/browser");
  init({
    dsn,
    // ⚠️ 沒有這行就會直連 DSN 裡那個 host —— 而那把 key 是假的，事件會全部丟失，
    //   而且是靜默的（SDK 不會因為上報失敗而報錯）。
    tunnel: "/api/_report",
    release: import.meta.env.VITE_RELEASE,
    environment: import.meta.env.DEV ? "development" : "production",
    // 不送 IP / cookie / 使用者資訊。來源 IP 由後端從 X-Forwarded-For 帶過去 ——
    // 那是伺服器側的決定，不是這裡塞進事件裡的。
    sendDefaultPii: false,
    // 只要錯誤。tracing / replay 都不開，那是 bundle 的大頭。
    tracesSampleRate: 0,
    // 送出前的最後一道：把「不是我們的錯、也修不了」的東西丟掉。
    beforeSend(event, hint) {
      const err = hint.originalException;
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "";

      // 瀏覽器外掛、翻譯工具注入的腳本出錯時，stack 會指向 chrome-extension:// 之類。
      // 那些改不了，留著只會淹掉真的問題。
      const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
      if (frames.some((f) => /^(chrome|moz|safari|webkit)-extension:\/\//.test(f.filename ?? ""))) {
        return null;
      }

      // ResizeObserver 的這則是瀏覽器規格層面的噪音（Chrome 在 observer callback
      // 沒能在同一幀跑完時發），不代表任何實際故障，業界普遍過濾。
      if (msg.includes("ResizeObserver loop")) return null;

      // 使用者切走頁面/重整時未完成的請求會冒這個，不是故障。
      if (msg === "Network Error" || msg.includes("Failed to fetch")) return null;

      return event;
    },
  });
}
