//! `WebDAV` 用的 HTTP Basic 認證。
//!
//! # 為什麼需要它
//!
//! 標準的 `WebDAV` 客戶端（macOS Finder、Windows 檔案總管、rclone、Cyberduck）
//! 只會 Basic 認證 —— 它們不會帶 Bearer token，也沒有 cookie jar。
//! 把 `/webdav` 放到 `require_auth` 底下之後端點安全了，但**沒有任何標準客戶端
//! 接得上**。這道 middleware 補上那半。
//!
//! # 憑證快取不是最佳化，是必要條件
//!
//! argon2 是**刻意**慢的。這台機器實測 **一次 verify 310ms**。而 `WebDAV`
//! 客戶端光是展開一層目錄就會發好幾個 PROPFIND/GET —— 每個都做一次 argon2
//! 等於整個功能不能用，而且是個現成的 `DoS` 放大器（一個請求換 310ms 的 CPU）。
//!
//! 所以驗過的憑證會快取 [`TTL`]。快取的鍵是
//! `(使用者名稱, SHA-256(密碼))` —— **不存明文**，而且密碼換了鍵就對不上，
//! 舊的快取自然失效。
//!
//! ⚠️ 快取有筆數上限 [`MAX_ENTRIES`]：沒有上限的話，隨機帳密的洪水可以把
//! 記憶體吃光。失敗的驗證**不**進快取。
//!
//! # 啟用 2FA 的帳號一律拒絕
//!
//! Basic 認證只有帳號密碼，沒有第二因素 —— 接受它等於替啟用 2FA 的帳號開一道
//! 繞過。那些帳號要用 `WebDAV` 的話需要「應用程式專用密碼」，那是另一件事。
//!
//! # 已知取捨
//!
//! Basic 認證每個請求都帶著密碼，所以**只有在 TLS 底下才可接受**。
//! 這個部署前面是 nginx 終止 TLS。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};

use crate::state::AppState;
use crate::utils::hash::verify_password_async;

/// 驗過的憑證留多久。短到密碼／2FA 改動很快生效，長到一次目錄展開不會重算。
const TTL: Duration = Duration::from_secs(300);

/// 快取筆數上限 —— 防止隨機帳密的洪水把記憶體吃光。
const MAX_ENTRIES: usize = 256;

/// `(使用者名稱, SHA-256(密碼))`。⚠️ 不存明文密碼。
type CacheKey = (String, [u8; 32]);

#[derive(Clone, Default)]
pub struct BasicAuthCache(Arc<Mutex<HashMap<CacheKey, (i64, Instant)>>>);

impl BasicAuthCache {
    fn get(&self, key: &CacheKey) -> Option<i64> {
        let mut map = self.0.lock().ok()?;
        match map.get(key) {
            Some((id, at)) if at.elapsed() < TTL => Some(*id),
            Some(_) => {
                map.remove(key);
                None
            }
            None => None,
        }
    }

    fn put(&self, key: CacheKey, user_id: i64) {
        let Ok(mut map) = self.0.lock() else { return };
        // 先掃掉過期的；還是滿的話整個清空。
        // 用 LRU 才「正確」，但那需要多一個相依，而這裡最壞情況只是
        // 下一次請求要重算一次 argon2。
        if map.len() >= MAX_ENTRIES {
            map.retain(|_, (_, at)| at.elapsed() < TTL);
            if map.len() >= MAX_ENTRIES {
                map.clear();
            }
        }
        map.insert(key, (user_id, Instant::now()));
    }
}

/// 拆 `Authorization: Basic base64(user:pass)`。
fn parse_basic(header_value: &str) -> Option<(String, String)> {
    let encoded = header_value.strip_prefix("Basic ")?;
    let decoded = decode_base64(encoded.trim())?;
    let text = String::from_utf8(decoded).ok()?;
    // ⚠️ 只切第一個冒號 —— 密碼本身可以含冒號（RFC 7617 明講使用者名稱不行、
    // 密碼可以）。用 split(':') 取兩段會把那種密碼截斷。
    let (user, pass) = text.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

fn decode_base64(s: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let idx = u32::try_from(TABLE.iter().position(|&t| t == c)?).ok()?;
        buf = (buf << 6) | idx;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(u8::try_from((buf >> bits) & 0xFF).ok()?);
        }
    }
    Some(out)
}

/// 回 401 並附上 `WWW-Authenticate`，客戶端才會跳出帳密輸入框。
fn challenge() -> Response {
    with_challenge(StatusCode::UNAUTHORIZED.into_response())
}

/// 把 `WWW-Authenticate` 補到一個既有的回應上。
fn with_challenge(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static(r#"Basic realm="Koimsurai NAS", charset="UTF-8""#),
    );
    response
}

// ⚠️ 回 `Response` 而不是 `Result<Response, Response>`：clippy 的
// result_large_err 會擋（axum 的 Response 至少 128 bytes，而這是每個
// WebDAV 請求都會走的路徑）。這裡的「錯誤」本來就是一個要送出去的
// 401 回應，包進 Result 沒有多帶資訊。
pub async fn basic_auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let header_value = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default()
        .to_string();

    // 不是 Basic 就交給後面的 require_auth（Bearer / cookie）處理。
    // ⚠️ 這裡**不能**直接拒絕：網頁前端也會打 /webdav，它帶的是 cookie。
    //
    // ⚠️ 但如果下游回了 401，一定要補上 WWW-Authenticate —— WebDAV 客戶端的
    // **第一個請求本來就不帶憑證**，它要靠那個標頭才知道該跳出帳密輸入框。
    // 少了它，Finder／檔案總管顯示的是「連不上」而不是「請輸入密碼」，
    // 於是整個 Basic 認證等於沒接（部署後實測抓到的：未帶憑證的 401 是裸的）。
    if !header_value.starts_with("Basic ") {
        let response = next.run(request).await;
        return if response.status() == StatusCode::UNAUTHORIZED
            && !response.headers().contains_key(header::WWW_AUTHENTICATE)
        {
            with_challenge(response)
        } else {
            response
        };
    }

    let Some((username, password)) = parse_basic(&header_value) else {
        return challenge();
    };

    let key: CacheKey = (username.clone(), Sha256::digest(password.as_bytes()).into());

    if let Some(user_id) = state.basic_auth_cache.get(&key) {
        let mut request = request;
        request.extensions_mut().insert(user_id);
        return next.run(request).await;
    }

    let row = sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT id, password_hash, COALESCE(totp_enabled, 0) FROM users WHERE username = ?",
    )
    .bind(&username)
    .fetch_optional(&state.pool)
    .await;

    let Ok(Some((user_id, password_hash, totp_enabled))) = row else {
        return challenge();
    };

    // 見模組說明：Basic 只有帳密，接受它等於替 2FA 帳號開一道繞過。
    if totp_enabled != 0 {
        tracing::warn!("使用者 {username} 啟用了 2FA，不允許用 Basic 認證存取 WebDAV");
        return challenge();
    }

    let ok = verify_password_async(password, password_hash)
        .await
        .unwrap_or(false);
    if !ok {
        // ⚠️ 失敗的不進快取：那會讓攻擊者用隨機帳密把快取灌爆。
        // 暴力破解本身由 argon2 的成本擋著（實測一次 310ms）。
        return challenge();
    }

    state.basic_auth_cache.put(key, user_id);
    let mut request = request;
    request.extensions_mut().insert(user_id);
    next.run(request).await
}
