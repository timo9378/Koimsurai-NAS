//! 前端錯誤的**轉發端點**（Sentry SDK 的 `tunnel` 模式）。
//!
//! 前端不直接打 GlitchTip，改成把 envelope POST 到這裡，由後端轉發。三個理由：
//!
//!   1. **DSN 不外流。** 直連的話 public key 一定出現在 bundle 裡（那是 SDK 的設計，
//!      不是失誤），任何人抄走就能往這個專案灌事件。走這裡的話真 key 只在後端環境變數。
//!   2. **擋廣告外掛不會誤殺。** uBlock 那類會用通用規則比對 `/envelope/`、
//!      `/api/N/store/` 這種路徑，而被擋時是**靜默的** —— 前端以為送出去了，
//!      你以為沒出錯。改成自家路徑就不在那些規則的範圍內。
//!   3. **`GlitchTip` 的 ingest 端點不必對這個站開。**
//!
//! ⚠️ 這個端點**無認證**（錯誤可能發生在登入之前，帶不了 token）。防濫用靠三層：
//!    body 上限、DSN 比對、以及 nginx 既有的 `limit_req`。
//!
//! ⚠️ 一律回 **202**，不論轉發成不成功。上游怎麼了是我們的事，不要讓前端把
//!    「錯誤回報失敗」當成需要重試的錯誤 —— 那正是製造無窮迴圈的方法。

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use std::time::Duration;

use crate::state::AppState;

/// envelope 上限。Sentry 事件含 stack trace + breadcrumbs，正常在幾十 KB；
/// 200KB 是「夠用且擋得住灌」的折衷。
const MAX_BODY: usize = 200 * 1024;

/// 轉發的整體逾時。這是個小 POST，慢到 5 秒就代表上游有事，沒有等下去的價值。
const FORWARD_TIMEOUT: Duration = Duration::from_secs(5);

/// 從 DSN 拆出轉發需要的三件事。
///
/// DSN 形狀：`http://<public_key>@<host>:<port>/<project_id>`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dsn {
    pub public_key: String,
    /// 已含 scheme 與 host:port，例如 `http://glitchtip:8000`
    pub origin: String,
    pub project_id: String,
}

impl Dsn {
    pub fn parse(raw: &str) -> Option<Self> {
        let url = reqwest::Url::parse(raw).ok()?;
        let public_key = url.username().to_string();
        if public_key.is_empty() {
            return None;
        }
        let project_id = url.path().trim_matches('/').to_string();
        if project_id.is_empty() {
            return None;
        }
        let host = url.host_str()?;
        let origin = match url.port() {
            Some(port) => format!("{}://{host}:{port}", url.scheme()),
            None => format!("{}://{host}", url.scheme()),
        };
        Some(Self {
            public_key,
            origin,
            project_id,
        })
    }

    /// `GlitchTip` 的 envelope ingest 端點。key 放在查詢字串 —— 那是 Sentry 協定的形狀。
    fn envelope_url(&self) -> String {
        format!(
            "{}/api/{}/envelope/?sentry_key={}",
            self.origin, self.project_id, self.public_key
        )
    }
}

/// 後端持有的真 DSN。沒設就整條路徑停用（本機開發的預設狀態）。
fn frontend_dsn() -> Option<Dsn> {
    Dsn::parse(&std::env::var("SENTRY_FRONTEND_DSN").ok()?)
}

/// bundle 裡那把是假 key（見前端 `src/lib/errorReporting.ts` 的說明），
/// 所以這裡比對的是「前端**宣稱**的 key」與我們發給它的那把是否一致。
fn expected_public_key() -> Option<String> {
    std::env::var("SENTRY_TUNNEL_PUBLIC_KEY").ok()
}

/// `POST /api/_report` —— Sentry SDK 的 `tunnel` 目的地。
pub async fn tunnel(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let Some(dsn) = frontend_dsn() else {
        return StatusCode::ACCEPTED;
    };
    if body.len() > MAX_BODY {
        tracing::warn!(size = body.len(), "envelope 超過上限，丟棄");
        return StatusCode::ACCEPTED;
    }

    // envelope 的第一行是 header JSON；tunnel 模式下 SDK 會把 dsn 放進去。
    // 我們拿它來**驗證**，不是拿來當路由 —— 照著它走就等於開放轉發。
    let Some(first_line) = body.split(|&b| b == b'\n').next() else {
        return StatusCode::ACCEPTED;
    };
    let Ok(header) = serde_json::from_slice::<serde_json::Value>(first_line) else {
        return StatusCode::ACCEPTED;
    };
    let claimed = header.get("dsn").and_then(|v| v.as_str()).unwrap_or_default();

    // 只認自己發出去的那把 key。不驗的話這裡就是一個對外開放的 Sentry 轉發器，
    // 任何人都能拿它往**別人的**專案送東西（然後這台被當成濫用來源）。
    let expected = expected_public_key();
    match (Dsn::parse(claimed), expected) {
        (Some(d), Some(exp)) if d.public_key == exp => {}
        _ => {
            tracing::warn!("envelope 的 DSN 不符，丟棄");
            return StatusCode::ACCEPTED;
        }
    }

    let mut req = state
        .http
        .post(dsn.envelope_url())
        .header("content-type", "application/x-sentry-envelope")
        .timeout(FORWARD_TIMEOUT)
        .body(body);

    // 把真實來源 IP 帶過去，GlitchTip 才分得出是哪一台的錯誤。
    // 這是伺服器側的決定 —— 前端的 sendDefaultPii 是關的，事件本身不含 IP。
    for name in ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"] {
        if let Some(v) = headers.get(name) {
            req = req.header("x-forwarded-for", v);
            break;
        }
    }

    match req.send().await {
        Ok(res) if res.status().is_success() => {}
        Ok(res) => tracing::warn!(status = %res.status(), "轉發 envelope 被上游拒絕"),
        Err(e) => tracing::warn!(error = %e, "轉發 envelope 失敗"),
    }
    StatusCode::ACCEPTED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_dsn_with_explicit_port() {
        let d = Dsn::parse("http://abc123@glitchtip:8000/7").expect("應解析得出");
        assert_eq!(d.public_key, "abc123");
        assert_eq!(d.origin, "http://glitchtip:8000");
        assert_eq!(d.project_id, "7");
        assert_eq!(
            d.envelope_url(),
            "http://glitchtip:8000/api/7/envelope/?sentry_key=abc123"
        );
    }

    #[test]
    fn parses_a_dsn_without_port() {
        let d = Dsn::parse("https://key@glitchtip.example.com/2").expect("應解析得出");
        assert_eq!(d.origin, "https://glitchtip.example.com");
    }

    #[test]
    fn rejects_dsn_without_key_or_project() {
        // 少了 key 或 project id 就沒辦法轉發，寧可整條停用也不要送到錯的地方
        assert_eq!(Dsn::parse("http://glitchtip:8000/7"), None);
        assert_eq!(Dsn::parse("http://abc@glitchtip:8000/"), None);
        assert_eq!(Dsn::parse("not a url"), None);
    }
}
