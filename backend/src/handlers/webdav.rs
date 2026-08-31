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
//! ⚠️ 標準的 `WebDAV` 客戶端（Finder、Windows 檔案總管、rclone）用的是
//! HTTP Basic 認證，而 `require_auth` 只認 Bearer 與 cookie —— 所以那些
//! 客戶端目前接不上。這不是這次修正造成的退步：`strip_prefix` 沒設之前
//! 這個端點對正常請求本來就一律 404，沒有人接得上。要讓它真的可用得另外
//! 加 Basic 認證，那是獨立的一件事。

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
