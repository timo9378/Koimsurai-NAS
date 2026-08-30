//! 認證守衛（`middleware/auth.rs`）與 JWT（`utils/jwt.rs`）。
//!
//! ⚠️ 守衛壞掉是**沒有症狀**的那種故障：條件寫反就是「全部放行」，而所有
//! 功能仍然正常運作。導入覆蓋率時 middleware/auth.rs 只有 47.75%、
//! utils/jwt.rs 51.67%，缺的正好是拒絕的那些分支 —— 也就是它存在的理由。
//!
//! 這支測的是**反向路徑**：什麼情況該被擋下來。

mod common;

use common::{register_and_login, spawn_app};
use jsonwebtoken::{encode, EncodingKey, Header};
use reqwest::{Client, StatusCode};
use serde_json::json;
use Koimsurai_NAS::utils::jwt::{create_access_token_with_secret, verify_token_with_secret};

/// 測試用的 secret，跟 `spawn_app` 設進環境變數的那個一致。
const TEST_SECRET: &str = "test_jwt_secret_for_tests";

/// 一個需要登入的端點（GET，所以不會被 CSRF 檢查擋住）。
fn protected_url(address: &str) -> String {
    format!("{address}/api/files")
}

// ─────────────────────────── JWT 本身 ───────────────────────────

#[test]
fn token_round_trips_and_carries_the_user_id() {
    let token = create_access_token_with_secret(42, TEST_SECRET).expect("create");
    let claims = verify_token_with_secret(&token, TEST_SECRET).expect("verify");
    assert_eq!(claims.sub, "42");
}

#[test]
fn token_signed_with_another_secret_is_rejected() {
    // ⚠️ 這條是簽章驗證的核心。少了它，「驗證時忽略簽章」的變異不會被抓到，
    //    而那個變異的症狀是：任何人都能自己造一張 token。
    let token = create_access_token_with_secret(1, "someone-elses-secret").expect("create");
    assert!(verify_token_with_secret(&token, TEST_SECRET).is_err());
}

#[test]
fn garbage_is_rejected_rather_than_panicking() {
    for bad in ["", "not-a-jwt", "a.b.c", "....."] {
        assert!(
            verify_token_with_secret(bad, TEST_SECRET).is_err(),
            "{bad:?} 應該被拒絕"
        );
    }
}

#[test]
fn expired_token_is_rejected() {
    // 正式 API 只發 now+15min 的 token，造不出過期的那張，所以這裡手工鑄一個。
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let past = usize::try_from(chrono::Utc::now().timestamp() - 3600).expect("timestamp");
    let token = encode(
        &Header::default(),
        &Claims {
            sub: "1".to_string(),
            exp: past,
        },
        &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .expect("encode");

    assert!(
        verify_token_with_secret(&token, TEST_SECRET).is_err(),
        "過期的 token 必須被拒絕 —— 簽章是對的，唯一擋得住的就是 exp 檢查"
    );
}

// ─────────────────────── 守衛：該擋的要擋 ───────────────────────

#[tokio::test]
async fn no_credentials_is_401() {
    let app = spawn_app().await;
    let res = Client::new()
        .get(protected_url(&app.address))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invalid_bearer_token_is_401() {
    let app = spawn_app().await;
    for bad in ["Bearer not-a-jwt", "Bearer ", "Basic dXNlcjpwYXNz"] {
        let res = Client::new()
            .get(protected_url(&app.address))
            .header("Authorization", bad)
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{bad:?} 應為 401");
    }
}

#[tokio::test]
async fn token_signed_with_the_wrong_secret_is_401_at_the_edge() {
    let app = spawn_app().await;
    let forged = create_access_token_with_secret(1, "attacker-secret").expect("create");
    let res = Client::new()
        .get(protected_url(&app.address))
        .header("Authorization", format!("Bearer {forged}"))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn valid_bearer_token_gets_through() {
    let app = spawn_app().await;
    let token = create_access_token_with_secret(1, TEST_SECRET).expect("create");
    let res = Client::new()
        .get(protected_url(&app.address))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("request");
    // ⚠️ 必須有這條正向的：只測「該擋的擋住」的話，「全部都擋」也會全綠。
    assert_ne!(res.status(), StatusCode::UNAUTHORIZED, "有效 token 不該被擋");
}

// ─────────────────────── 守衛：CSRF 那半 ───────────────────────
//
// cookie 認證的**寫入類**請求要求 Origin 或 Referer。Bearer 不受此限制 ——
// 它必須由 JS 明確附上，跨站表單送不出來。

#[tokio::test]
async fn cookie_mutating_request_without_origin_or_referer_is_403() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "csrf_victim").await;

    // ⚠️ 這是 CSRF 防護的預設拒絕分支。破掉的話症狀是「沒有症狀」——
    //    正常使用照舊（瀏覽器一定會送 Origin），只是防護沒了。
    let res = client
        .post(format!("{}/api/share", app.address))
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cookie_mutating_request_with_foreign_origin_is_403() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "csrf_victim2").await;

    let res = client
        .post(format!("{}/api/share", app.address))
        .header("Origin", "https://evil.example.com")
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cookie_mutating_request_with_matching_origin_is_allowed() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "legit_user").await;

    let res = client
        .post(format!("{}/api/share", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert!(res.status().is_success(), "同源的請求應該放行：{}", res.status());
}

#[tokio::test]
async fn cookie_read_request_does_not_need_origin() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "reader").await;

    // ⚠️ CSRF 檢查只該套在寫入類方法上。套到 GET 的話，正常的頁面載入
    //    會整片 403 —— 這條擋的是「把檢查放寬到所有方法」那種改法。
    let res = client
        .get(protected_url(&app.address))
        .send()
        .await
        .expect("request");
    assert_ne!(res.status(), StatusCode::FORBIDDEN);
    assert_ne!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn bearer_mutating_request_needs_no_origin() {
    let app = spawn_app().await;
    // 先建一個真實的使用者，讓 user_id = 1 存在
    let _ = register_and_login(&app, "bearer_user").await;
    let token = create_access_token_with_secret(1, TEST_SECRET).expect("create");

    // ⚠️ Bearer 刻意豁免 CSRF 檢查：跨站的表單／img 送不出 Authorization header，
    //    所以那條攻擊路徑本來就不存在。這條釘住「不要順手把 Bearer 也一起檢查」。
    let res = Client::new()
        .post(format!("{}/api/share", app.address))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert_ne!(res.status(), StatusCode::FORBIDDEN, "Bearer 不該被 CSRF 檢查擋下");
}

#[tokio::test]
async fn cookie_mutating_request_with_origin_that_only_prefixes_the_host_is_403() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "prefix_victim").await;

    // ⚠️ Origin 是 `<host>.evil.example.com`。它**以** Host 開頭，
    //    所以任何用 `starts_with` 做的比對都會放行 —— 而那是一個
    //    攻擊者完全控制得了的網域（真實世界的形式是
    //    `nas.koimsurai.com.evil.com`）。
    let host = app.address.trim_start_matches("http://");
    let res = client
        .post(format!("{}/api/share", app.address))
        .header("Origin", format!("http://{host}.evil.example.com"))
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "只是「以 Host 開頭」的 Origin 必須被擋"
    );
}

// ─────────────── 讀環境變數的相容包裝（尚未遷到 AppState 的呼叫點） ───────────────
//
// ⚠️ 這幾條靠 nextest「一個測試一個行程」才安全 —— `set_var` / `remove_var`
// 是 process 全域的。`cargo test` 下同行程平行跑會互相蓋，那也是本專案
// 不用 cargo test 的理由之一（見 ci.yml）。

#[test]
fn env_based_helpers_round_trip() {
    std::env::set_var("JWT_SECRET", "env-secret");
    let token = Koimsurai_NAS::utils::jwt::create_access_token(7).expect("create");
    let claims = Koimsurai_NAS::utils::jwt::verify_token(&token).expect("verify");
    assert_eq!(claims.sub, "7");
}

#[test]
fn env_based_helpers_fail_loudly_when_the_secret_is_missing() {
    std::env::remove_var("JWT_SECRET");
    // ⚠️ 重點是「失敗」而不是「用某個預設值」。少了 secret 卻還能發 token，
    //    代表全世界都知道那把鑰匙。
    assert!(Koimsurai_NAS::utils::jwt::create_access_token(1).is_err());
    assert!(Koimsurai_NAS::utils::jwt::verify_token("whatever").is_err());
}

#[test]
fn a_token_is_not_accepted_after_the_secret_is_rotated() {
    // 金鑰輪替之後舊 token 必須失效 —— 這正是 §9 那次資安事件的處置手段：
    // 換掉 JWT_SECRET 讓外洩期間發出的所有 token 一次作廢。
    std::env::set_var("JWT_SECRET", "old-secret");
    let token = Koimsurai_NAS::utils::jwt::create_access_token(1).expect("create");
    assert!(Koimsurai_NAS::utils::jwt::verify_token(&token).is_ok());

    std::env::set_var("JWT_SECRET", "rotated-secret");
    assert!(
        Koimsurai_NAS::utils::jwt::verify_token(&token).is_err(),
        "輪替後舊 token 必須失效"
    );
}
