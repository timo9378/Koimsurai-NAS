//! 路徑權限（`handlers/permission.rs`）。導入覆蓋率時這支檔案是 **0%**。
//!
//! ⚠️ 這個端點原本完全沒有授權檢查：呼叫者的 `user_id` 被顯式忽略，
//! 而 `payload.user_id` 是客戶端說了算的 —— 任何已登入者都能替任何人設定
//! 任何路徑的權限。而 `permissions` 只在「有一列且值為 false」時才拒絕，
//! 所以攻擊是把別人**鎖在門外**，不是替自己開門。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, StatusCode};
use serde_json::json;

/// 依使用者名稱查 id。
///
/// ⚠️ 直接查 DB 而不是問 API —— 這個後端**沒有**「我是誰」的端點，
/// 登入回應也不帶 user id（見 models/user.rs 的 LoginResponse）。
/// 測試 harness 提供 `pool` 就是為了這種情況。
async fn user_id(app: &TestApp, username: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE username = ?")
        .bind(username)
        .fetch_one(&app.pool)
        .await
        .expect("查得到使用者")
}

#[tokio::test]
async fn cannot_set_permissions_for_someone_else() {
    let app = spawn_app().await;
    let victim = register_and_login(&app, "victim").await;
    let victim_id = user_id(&app, "victim").await;

    let attacker = register_and_login(&app, "attacker").await;
    let res = attacker
        .post(format!("{}/api/permissions", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "user_id": victim_id, "path": "", "can_read": false, "can_write": false }))
        .send()
        .await
        .expect("set permission");

    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "不該能替別人設定權限（那等於把對方鎖在門外）"
    );

    // 而且受害者要還能正常建資料夾
    let create = victim
        .post(format!("{}/api/files/folder", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "path": "", "folder_name": "still-works" }))
        .send()
        .await
        .expect("create folder");
    assert_eq!(create.status(), StatusCode::CREATED, "受害者的權限不該被動到");
}

#[tokio::test]
async fn can_set_permissions_for_yourself() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "self_perm").await;
    let id = user_id(&app, "self_perm").await;

    let res = client
        .post(format!("{}/api/permissions", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "user_id": id, "path": "mine", "can_read": true, "can_write": true }))
        .send()
        .await
        .expect("set permission");
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn requires_login() {
    let app = spawn_app().await;
    let res = Client::new()
        .post(format!("{}/api/permissions", app.address))
        .json(&json!({ "user_id": 1, "path": "", "can_read": false, "can_write": false }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}
