use crate::state::AppState;
use crate::utils::jwt::verify_token_with_secret;
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use axum_extra::extract::CookieJar;

pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // ⚠️ 上游已經認證過就直接放行。
    //
    // WebDAV 的路由在這道**外面**還掛了一道 Basic 認證（見
    // middleware/basic_auth.rs）—— 標準的 WebDAV 客戶端只會 Basic，
    // 不帶 Bearer 也沒有 cookie。它驗過之後會把 user_id 放進 extensions，
    // 這裡如果不讓路就會把它擋掉，症狀是「Basic 認證看起來成功但還是 401」。
    //
    // 安全上沒有放寬：extensions 是**行程內**的型別化容器，客戶端塞不進東西，
    // 唯一能寫進 i64 的就是同一條 layer 鏈上的其他 middleware。
    if request.extensions().get::<i64>().is_some() {
        return Ok(next.run(request).await);
    }

    // First try Authorization header (explicit token, immune to CSRF)
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let mut token_opt: Option<String> = None;

    if let Some(h) = auth_header {
        if let Some(bearer) = h.strip_prefix("Bearer ") {
            token_opt = Some(bearer.to_string());
        }
    }
    let is_bearer_auth = token_opt.is_some();

    // Fallback to Cookie (using axum-extra CookieJar for correct parsing)
    if token_opt.is_none() {
        if let Some(cookie) = jar.get("access_token") {
            token_opt = Some(cookie.value().to_string());
        }
    }

    // For state-changing requests via Cookie auth, require Origin/Referer check (CSRF mitigation)
    // Bearer tokens are immune since they must be explicitly attached by JS
    if token_opt.is_some() && !is_bearer_auth {
        // Cookie-based auth — check for CSRF on mutating methods
        let method = request.method().clone();
        if method == axum::http::Method::POST
            || method == axum::http::Method::PUT
            || method == axum::http::Method::DELETE
            || method == axum::http::Method::PATCH
        {
            let origin = request
                .headers()
                .get(header::ORIGIN)
                .and_then(|h| h.to_str().ok())
                .map(std::string::ToString::to_string);
            let referer = request
                .headers()
                .get(header::REFERER)
                .and_then(|h| h.to_str().ok())
                .map(std::string::ToString::to_string);
            let host = request
                .headers()
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .map(std::string::ToString::to_string);

            // 如果有 Origin header，驗證它是否匹配 Host
            if let Some(ref origin_val) = origin {
                if let Some(ref host_val) = host {
                    // 從 Origin 中提取主機名
                    let origin_host = origin_val
                        .trim_start_matches("http://")
                        .trim_start_matches("https://");
                    // ⚠️ 一定要用**完全相等**，不能用 `starts_with`。
                    //
                    // 之前是 `origin_host.starts_with(host_val)`，而那是一個
                    // 貨真價實的 CSRF 繞過：Host 是 `nas.koimsurai.com` 時，
                    // 攻擊者只要準備 `nas.koimsurai.com.evil.com` 這個網域，
                    // 送出的 Origin 就「以 Host 開頭」而通過檢查——那個網域
                    // 完全由攻擊者控制，註冊得到。
                    //
                    // 相等比 starts_with 嚴格，但嚴格掉的**只有**上述那種
                    // 「Host + 後綴」的情形；合法的同源請求兩者本來就一字不差。
                    // 主機名依 DNS 規範不分大小寫。
                    if !origin_host.eq_ignore_ascii_case(host_val.as_str()) {
                        tracing::warn!(
                            "CSRF check failed: Origin '{}' does not match Host '{}'",
                            origin_val,
                            host_val
                        );
                        return Err(StatusCode::FORBIDDEN);
                    }
                }
            } else if referer.is_none() {
                // 既沒有 Origin 也沒有 Referer — 預設拒絕（CSRF 防護）
                // Cookie 搭配 SameSite=Lax 已阻擋大部分跨站 POST，
                // 但缺少 Origin/Referer 的 mutating 請求仍應視為可疑。
                tracing::warn!(
                    "CSRF blocked: Cookie-based mutating request without Origin or Referer header"
                );
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    let Some(token) = token_opt else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    // 使用 AppState 中的 jwt_secret 驗證 token（避免每次讀取 env var）
    match verify_token_with_secret(&token, &state.jwt_secret) {
        Ok(claims) => {
            let mut request = request;
            let user_id = claims.sub.parse::<i64>().map_err(|_| StatusCode::UNAUTHORIZED)?;
            request.extensions_mut().insert(user_id);
            Ok(next.run(request).await)
        }
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}
