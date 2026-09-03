//! `WebDAV`。
//!
//! ⚠️ 這個 handler 本身**不做認證** —— 認證由 `routes/mod.rs` 掛的
//! `require_auth` layer 負責。那不是可選的：
//!
//! 2026-08-31 的稽核發現這兩條路由當時掛在根 router 上、不在任何 auth
//! layer 底下，於是**完全不需要憑證**就能對整個儲存空間讀、寫、刪、列目錄：
//!
//! ```text
//! MKCOL    /webdav                  → 201
//! PUT      /webdav/x.txt            → 201
//! GET      /webdav/../top-secret    → 200 ← `..` 爬得出去，整個儲存根都在裡面
//! DELETE   /webdav/../anything      → 204
//! PROPFIND /webdav/..  Depth: 1     → 207
//! ```
//!
//! 只有「爬出儲存根」被 `LocalFs` 擋住（403）。
//!
//! 標準客戶端（Finder、Windows 檔案總管、rclone）走 HTTP Basic，由
//! `middleware/basic_auth.rs` 處理 —— 那一段的註解裡有憑證快取與 2FA 的細節。
//!
//! ⚠️ **開了 2FA 的帳號一律被拒絕**：Basic 只有帳密，沒有第二因素的位置。
//! 而且那個檢查必須排在憑證快取**前面** —— 掛反了的話，最近用過 WebDAV 的
//! 帳號開啟 2FA 之後仍然通行到快取過期為止。
//!
//! ⚠️ **寫入沒有暫存檔保護。** dav-server 的 `LocalFs` 是直接寫最終路徑的，
//! 所以大檔案上傳到一半斷線會留下一個殘缺的檔案（而 tus 與上傳連結現在都
//! 是「暫存檔 + 原子 rename」）。這是 WebDAV 協定本身的形狀：PUT 沒有
//! 「完成」的訊號可以拿來當 rename 的時機，客戶端預期的行為就是重傳覆蓋。
//! 索引器看到的大小在寫入期間也會是部分的，但每次 modify 事件都會重新索引，
//! 寫完就會校正回來。

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Request, State},
    response::IntoResponse,
};

/// `WebDAV` 掛在哪一段路徑。
///
/// ⚠️ `routes/mod.rs` 的路由與 `lib.rs` 的 `DavHandler::strip_prefix`
/// **必須**用同一個值。不一致的話 dav-server 會拿到帶前綴的路徑，
/// 去找 `<storage>/webdav/...`，症狀是所有請求都 404。
pub const MOUNT_PATH: &str = "/webdav";

pub async fn webdav_handler(State(state): State<AppState>, req: Request<Body>) -> impl IntoResponse {
    state.webdav.handle(req).await
}
