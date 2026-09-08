//! 後端錯誤上報 → 自架 `GlitchTip`（Sentry 協定相容）。
//!
//! 前端早就接了（`src/lib/errorReporting.ts`），後端一直沒有 —— 所以後端的
//! panic、500、DB 失敗全部只存在於 `docker logs` 裡，沒有人會去看。
//!
//! ## ⚠️ 這個東西抓不到什麼
//!
//! **抓不到 `SIGKILL`。** 2026-09-08 後端被 OOM killer 殺掉三次，
//! 而 `SIGKILL` 不給任何執行機會：沒有 handler、沒有 unwinding、沒有 flush。
//! 那次的根因是縮圖沒有併發上限（見 `utils/image.rs` 的 `THUMBNAIL_SLOTS`），
//! 靠的是 `docker inspect` 的重啟時間與 nginx 的 502 才查出來，不是靠上報。
//!
//! 記憶體被殺這類事情要靠**容器層的監控**（重啟次數、記憶體用量），
//! 不是靠行程內的錯誤回報。這裡能抓的是 panic 與 `tracing::error!`。
//!
//! ## 為什麼直連而不是像前端那樣走 tunnel
//!
//! 前端走 tunnel 是因為 DSN 會進 bundle、而且會被廣告外掛擋。
//! 後端兩個問題都沒有：DSN 只在環境變數裡，也沒有外掛。而且後端跟
//! `GlitchTip` 在同一個 docker network 上（compose 的 `observability`），
//! `http://glitchtip:8000` 直達，不必繞出去經 nginx 再回來。

use sentry::ClientInitGuard;

/// 已知的噪音 —— 這些 `error!` 不代表故障，只會淹掉真的問題。
///
/// 對應前端 `errorReporting.ts` 的 `beforeSend`：那邊擋的是瀏覽器外掛與
/// `ResizeObserver` 的噪音，這邊擋的是縮圖。
///
/// ⚠️ 這串**要保持很短**。過濾器長起來就代表在拿它當「不想修的東西」的垃圾桶，
/// 而那正是讓監控失去意義的方式。
///
/// 目前只有一條，而且它其實是別處的 bug：`generate_thumbnail_fallback` 走的是
/// `image` crate，只有圖片解得開，但呼叫端對**影片**也會呼叫它。於是每上傳一
/// 支影片就固定噴一則 `error!`（實測 72 小時內 30 則）。正確的修法是在呼叫端
/// 就不要對影片走 fallback；在那之前先擋住，否則接上 `GlitchTip` 的第一天就會
/// 被這一種事件淹掉。
const NOISE: &[&str] = &["Failed to decode image for fallback thumbnail"];

/// 這則訊息該不該送上去。
#[must_use]
pub fn is_noise(message: &str) -> bool {
    NOISE.iter().any(|n| message.contains(n))
}

/// 啟用錯誤上報。沒設 `SENTRY_BACKEND_DSN` 就回 `None`（本機開發的預設狀態）。
///
/// ⚠️ **一定要在 tokio runtime 之外呼叫。** sentry 的預設 transport 會建一個
/// `reqwest` 的 blocking client，而在 runtime 執行緒裡建 blocking client 會 panic
/// （「Cannot drop a runtime in a context where blocking is not allowed」）。
/// `main` 因此不用 `#[tokio::main]`，改成自己建 runtime —— 順序是刻意的。
///
/// ⚠️ 回傳的 guard **一定要活到程式結束**。提早 drop 會把 client 關掉，
/// 之後的事件全部靜靜地被丟掉 —— 不會有任何錯誤告訴你。
#[must_use]
pub fn init() -> Option<ClientInitGuard> {
    let dsn = std::env::var("SENTRY_BACKEND_DSN")
        .ok()
        .filter(|d| !d.is_empty())?;

    Some(sentry::init((dsn, client_options())))
}

/// 上報的設定。
///
/// ⚠️ 抽成函式是為了讓測試用到**同一組**設定。測試裡自己再拼一次 options 的話，
/// 測到的是那份複製品 —— 改壞 `init()` 裡的過濾器測試照樣綠。
fn client_options() -> sentry::ClientOptions {
    // ⚠️ `ClientOptions` 是 `#[non_exhaustive]`，不能用結構體字面量建
    // （`ClientOptions { .. }` 編譯不過）。只能先 `default()` 再逐項改。
    let mut options = sentry::ClientOptions::default();
    options.release = std::env::var("RELEASE").ok().map(Into::into);
    options.environment = Some(
        std::env::var("SENTRY_ENVIRONMENT")
            .unwrap_or_else(|_| "production".to_string())
            .into(),
    );
    // 不送 IP、不送使用者資訊。這是一台家用 NAS，事件裡不該有住在裡面的人的東西。
    options.send_default_pii = false;
    options.before_send = Some(std::sync::Arc::new(|event| {
        if is_noise(&event_message(&event)) {
            return None;
        }
        Some(event)
    }));
    options
}

/// 事件裡拿得到的那句話。
///
/// ⚠️ `message` 與 `logentry` 兩個欄位都要看。`sentry-tracing` 送上來的事件
/// 把訊息放在 `logentry`，只讀 `message` 的話過濾器永遠拿到空字串 ——
/// 那會是一個「看起來有裝、實際上什麼都沒擋」的過濾器。
fn event_message(event: &sentry::protocol::Event<'_>) -> String {
    if let Some(m) = &event.message {
        return m.clone();
    }
    if let Some(l) = &event.logentry {
        return l.message.clone();
    }
    // 例外事件（panic）的訊息在 exception 裡。
    event
        .exception
        .values
        .first()
        .and_then(|e| e.value.clone())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::is_noise;

    #[test]
    fn 縮圖的_fallback_噪音會被擋掉() {
        assert!(is_noise(
            "Failed to decode image for fallback thumbnail: The file extension `\"mp4\"` was not recognized as an image format"
        ));
        assert!(is_noise(
            "Failed to decode image for fallback thumbnail: Format error decoding Jpeg: I/O errors"
        ));
    }

    /// ⚠️ 這條比上面那條重要：過濾器擋過頭就等於沒有監控。
    #[test]
    fn 真的故障不會被擋掉() {
        for msg in [
            "tus 上傳落地失敗（id=abc）",
            "覆寫前存版本失敗",
            "Failed to execute FFmpeg: No such file or directory",
            "tus 落地後寫 files 表失敗",
            "Failed to create thumbnail directory",
            "Failed to save fallback thumbnail",
        ] {
            assert!(!is_noise(msg), "不該被當成噪音：{msg}");
        }
    }

    #[test]
    fn 空字串不是噪音() {
        assert!(!is_noise(""));
    }

    /// **整條鏈真的通嗎。**
    ///
    /// 上面那幾條只測 `is_noise` 這個字串比對，測不到「`tracing::error!` 送出來的
    /// 事件，訊息到底放在哪個欄位」。而那正是最容易猜錯、猜錯又完全沒有症狀的地方
    /// —— `event_message` 讀錯欄位的話它永遠拿到空字串，過濾器就變成
    /// 「看起來有裝、實際上什麼都不擋」。
    ///
    /// 所以這條真的裝上 `sentry_tracing` 的 layer、真的發一則 `error!`，
    /// 然後檢查 `before_send` 有沒有把它擋下來。
    ///
    /// 反向驗證：把 `event_message` 改成只回傳 `String::new()`，這條會紅在
    /// 「噪音應該被擋掉」。
    #[test]
    fn tracing_的_error_會經過噪音過濾器() {
        use tracing_subscriber::layer::SubscriberExt;

        // ⚠️ 參數順序是 (閉包, options)，不是 (options, 閉包)。
        let events = sentry::test::with_captured_events_options(
            || {
                let subscriber = tracing_subscriber::registry().with(sentry_tracing::layer());
                tracing::subscriber::with_default(subscriber, || {
                    tracing::error!("Failed to decode image for fallback thumbnail: not an image");
                    tracing::error!("tus 上傳落地失敗（id=abc）");
                });
            },
            super::client_options(),
        );

        let messages: Vec<String> = events.iter().map(super::event_message).collect();
        assert_eq!(
            events.len(),
            1,
            "噪音應該被擋掉、真故障應該留下，實際收到：{messages:?}"
        );
        assert!(
            messages[0].contains("tus 上傳落地失敗"),
            "留下來的應該是真故障，實際是：{messages:?}"
        );
    }
}
