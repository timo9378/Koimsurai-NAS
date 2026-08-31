//! Docker 管理端點的授權（`middleware/docker_admin.rs`）。
//!
//! ⚠️ 為什麼這批端點需要比 `require_auth` 更強的檢查：容器掛著
//! `/var/run/docker.sock` 且 `pid: host`，而
//! `GET /api/docker/containers/{id}/exec` 吃客戶端給的 `cmd`
//! （預設 `/bin/sh`）在任意容器裡執行 —— **能打到就等於主機 root**。
//!
//! 稽核時實測：production 上三個帳號全都做得到。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, StatusCode};

/// Docker 端點一覽 —— 新增路由時這裡也要跟著加，否則新的那條沒有人守。
const ENDPOINTS: &[&str] = &[
    "/api/docker/status",
    "/api/docker/containers",
    "/api/docker/containers/abc",
    "/api/docker/containers/abc/logs",
    "/api/docker/containers/abc/stats",
    "/api/docker/containers/abc/exec",
    "/api/docker/images",
    "/api/docker/networks",
];

async fn user_id(app: &TestApp, username: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE username = ?")
        .bind(username)
        .fetch_one(&app.pool)
        .await
        .expect("查得到使用者")
}

#[tokio::test]
async fn a_user_not_on_the_allowlist_is_rejected() {
    // ⚠️ 空清單 = 全部拒絕。這正是預設值要 fail-closed 的理由：
    // 部署時漏設環境變數的後果應該是「功能不能用」而不是「人人主機 root」。
    std::env::set_var("DOCKER_MANAGER_USER_IDS", "");
    let app = spawn_app().await;
    let client = register_and_login(&app, "not_admin").await;

    for path in ENDPOINTS {
        let res = client
            .get(format!("{}{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "{path} 對不在允許清單裡的使用者應該是 403"
        );
    }
}

#[tokio::test]
async fn an_allowlisted_user_gets_past_the_guard() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "docker_admin").await;
    let id = user_id(&app, "docker_admin").await;
    std::env::set_var("DOCKER_MANAGER_USER_IDS", id.to_string());

    let res = client
        .get(format!("{}/api/docker/status", app.address))
        .send()
        .await
        .expect("request");

    // ⚠️ 不能斷言 200：測試環境沒有啟用 Docker，所以會是 503（服務不可用）。
    // 要驗的是**通過了授權那道**，也就是「不是 403」。
    assert_ne!(
        res.status(),
        StatusCode::FORBIDDEN,
        "在允許清單裡的使用者不該被授權那道擋下（實際 {}）",
        res.status()
    );
}

#[tokio::test]
async fn anonymous_is_401_not_403() {
    std::env::set_var("DOCKER_MANAGER_USER_IDS", "1");
    let app = spawn_app().await;

    let res = Client::new()
        .get(format!("{}/api/docker/status", app.address))
        .send()
        .await
        .expect("request");
    // 未登入應該先被 require_auth 擋下 —— 順序反了的話這裡會是 403，
    // 而那表示 require_docker_admin 跑在 require_auth 之前，
    // 它永遠拿不到 user_id、於是連合法的管理員也會被擋。
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}
