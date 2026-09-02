//! 分享連結（`handlers/share.rs`）。
//!
//! 為什麼值得測：這是後端**不需要登入**就碰得到的兩條路徑之一，而它的判斷
//! （密碼、過期）全都屬於「反了也不會有人發現」的那種 —— 分享連結變成永不
//! 過期或不用密碼，功能看起來完全正常，只是安全性沒了。
//!
//! 導入覆蓋率時這支檔案是 **0%**。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{redirect::Policy, Client, StatusCode};
use serde_json::{json, Value};

fn public_client() -> Client {
    Client::builder()
        .redirect(Policy::none())
        .build()
        .expect("build client")
}

/// 建一個分享連結，回傳它的 id。
async fn create_share(app: &TestApp, client: &Client, body: Value) -> String {
    let res = client
        .post(format!("{}/api/share", app.address))
        // ⚠️ 少了 Origin 會拿到 403 而不是 200 —— 見 middleware/auth.rs 的 CSRF 檢查
        .header("Origin", app.origin_header())
        .json(&body)
        .send()
        .await
        .expect("create share");
    assert_eq!(res.status(), StatusCode::OK, "建立分享連結應成功");
    let v: Value = res.json().await.expect("json");
    v["id"].as_str().expect("回應要有 id").to_string()
}

#[tokio::test]
async fn create_requires_auth() {
    let app = spawn_app().await;
    let res = public_client()
        .post(format!("{}/api/share", app.address))
        .json(&json!({ "file_path": "a.txt" }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "未登入不該建得出分享連結");
}

#[tokio::test]
async fn info_and_download_work_without_login() {
    let app = spawn_app().await;
    app.write_file("報告.txt", b"hello share");
    let client = register_and_login(&app, "sharer").await;
    let id = create_share(&app, &client, json!({ "file_path": "報告.txt" })).await;

    // ⚠️ 這裡刻意用**沒有登入**的 client：分享連結的重點就是匿名可存取。
    let anon = public_client();

    let res = anon
        .get(format!("{}/api/share/{id}/info", app.address))
        .send()
        .await
        .expect("info");
    assert_eq!(res.status(), StatusCode::OK);
    let info: Value = res.json().await.expect("json");
    assert_eq!(info["file_name"], "報告.txt");
    assert_eq!(info["is_password_protected"], false);
    assert_eq!(info["is_directory"], false);
    assert_eq!(info["expires_at"], Value::Null, "沒設過期就該是 null，不是省略");

    let res = anon
        .get(format!("{}/api/share/{id}/download", app.address))
        .send()
        .await
        .expect("download");
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"hello share");
}

#[tokio::test]
async fn unknown_id_is_404_on_both_endpoints() {
    let app = spawn_app().await;
    let anon = public_client();
    for path in ["info", "download"] {
        let res = anon
            .get(format!("{}/api/share/does-not-exist/{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{path} 應為 404");
    }
}

#[tokio::test]
async fn password_protected_link_rejects_wrong_and_missing_password() {
    let app = spawn_app().await;
    app.write_file("secret.txt", b"classified");
    let client = register_and_login(&app, "pwd_sharer").await;
    let id = create_share(
        &app,
        &client,
        json!({ "file_path": "secret.txt", "password": "let-me-in" }),
    )
    .await;

    let anon = public_client();

    // info 不需要密碼，但必須誠實地說「這個連結有密碼」
    let info: Value = anon
        .get(format!("{}/api/share/{id}/info", app.address))
        .send()
        .await
        .expect("info")
        .json()
        .await
        .expect("json");
    assert_eq!(info["is_password_protected"], true);

    // 沒帶密碼 → 401
    let res = anon
        .get(format!("{}/api/share/{id}/download", app.address))
        .send()
        .await
        .expect("no pwd");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 帶錯密碼 → 401
    let res = anon
        .get(format!("{}/api/share/{id}/download?pwd=wrong", app.address))
        .send()
        .await
        .expect("bad pwd");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // ⚠️ 這條是重點：密碼對了才拿得到內容。少了它，「驗證邏輯整段拿掉」
    //    也能讓上面兩條通過（因為那時所有請求都會成功）。
    let res = anon
        .get(format!("{}/api/share/{id}/download?pwd=let-me-in", app.address))
        .send()
        .await
        .expect("good pwd");
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"classified");
}

#[tokio::test]
async fn expired_link_is_gone_on_info_and_not_found_on_download() {
    let app = spawn_app().await;
    app.write_file("old.txt", b"stale");
    let client = register_and_login(&app, "expiry_sharer").await;
    // 負的秒數 = 建立當下就已經過期
    let id = create_share(
        &app,
        &client,
        json!({ "file_path": "old.txt", "expires_in_seconds": -60 }),
    )
    .await;

    let anon = public_client();

    // ⚠️ 兩個端點對「過期」的回應**刻意不同**：info 回 410 讓前端能顯示
    //    「連結已過期」，download 回 404 不透露這個 id 曾經存在。
    //    這不是不一致，是刻意的；釘住它才不會有人「順手統一」掉。
    let res = anon
        .get(format!("{}/api/share/{id}/info", app.address))
        .send()
        .await
        .expect("info");
    assert_eq!(res.status(), StatusCode::GONE);

    let res = anon
        .get(format!("{}/api/share/{id}/download", app.address))
        .send()
        .await
        .expect("download");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn not_yet_expired_link_still_works() {
    let app = spawn_app().await;
    app.write_file("fresh.txt", b"fresh");
    let client = register_and_login(&app, "future_sharer").await;
    let id = create_share(
        &app,
        &client,
        json!({ "file_path": "fresh.txt", "expires_in_seconds": 3600 }),
    )
    .await;

    let res = public_client()
        .get(format!("{}/api/share/{id}/download", app.address))
        .send()
        .await
        .expect("download");
    // ⚠️ 少了這條，「過期判斷反過來寫」仍然會讓上面那支測試通過。
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn link_to_missing_file_is_404_not_500() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "ghost_sharer").await;
    // 檔案從來不存在（分享後被刪掉也是同一條路徑）
    let id = create_share(&app, &client, json!({ "file_path": "沒有這個檔.txt" })).await;

    let anon = public_client();
    for path in ["info", "download"] {
        let res = anon
            .get(format!("{}/api/share/{id}/{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{path} 應為 404 而不是 500");
    }
}

#[tokio::test]
async fn directory_share_is_zipped() {
    let app = spawn_app().await;
    app.write_file("相簿/a.txt", b"aaa");
    app.write_file("相簿/巢狀/b.txt", b"bbb");
    let client = register_and_login(&app, "dir_sharer").await;
    let id = create_share(&app, &client, json!({ "file_path": "相簿" })).await;

    let anon = public_client();

    let info: Value = anon
        .get(format!("{}/api/share/{id}/info", app.address))
        .send()
        .await
        .expect("info")
        .json()
        .await
        .expect("json");
    assert_eq!(info["is_directory"], true);
    // 目錄的大小是遞迴加總，不是 0
    assert_eq!(info["file_size"].as_u64().expect("size"), 6);

    let res = anon
        .get(format!("{}/api/share/{id}/download", app.address))
        .send()
        .await
        .expect("download");
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.bytes().await.expect("body");
    // zip 的 magic number。不解壓縮，只確認回的是 zip 而不是（例如）目錄的第一個檔。
    assert_eq!(&body[..2], b"PK", "目錄分享應該回 zip");
}

/// 公開連結的密碼不能被無限次嘗試。
///
/// ⚠️ 這條端點**不需要登入**，而密碼比對走 argon2（19 MiB / 次）。沒有次數
/// 上限的話有兩個後果：密碼可以暴力破解，而且每次嘗試都換走一次記憶體與 CPU
/// —— `spawn_blocking` 的池預設 512 條執行緒，灌併發可以逼出接近 10 GB。
#[tokio::test]
async fn repeated_wrong_passwords_get_rate_limited() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "bruteforce").await;
    std::fs::write(app.storage_dir.path().join("secret.txt"), b"x").expect("建立檔案");

    let id = create_share(
        &app,
        &client,
        json!({ "file_path": "secret.txt", "password": "correct horse" }),
    )
    .await;

    let anonymous = Client::new();
    let attempt = |pwd: &str| {
        let url = format!("{}/api/share/{id}/download?pwd={pwd}", app.address);
        let c = anonymous.clone();
        async move { c.get(url).send().await.expect("嘗試").status() }
    };

    let mut saw_limit = false;
    for i in 0..15 {
        let status = attempt("wrong").await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            saw_limit = true;
            assert!(i >= 5, "不該一開始就擋（第 {i} 次就 429 了）");
            break;
        }
        assert_eq!(status, StatusCode::UNAUTHORIZED, "第 {i} 次應該是 401");
    }
    assert!(saw_limit, "連續打錯應該要被擋下來，15 次都沒有");
}

/// 密碼對了就把額度還回去 —— 打錯幾次才輸對的人不該被後續請求誤鎖。
#[tokio::test]
async fn a_correct_password_clears_the_failure_budget() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "recovers").await;
    std::fs::write(app.storage_dir.path().join("s.txt"), b"content").expect("建立檔案");

    let id = create_share(&app, &client, json!({ "file_path": "s.txt", "password": "pw" })).await;

    let anonymous = Client::new();
    for _ in 0..3 {
        let res = anonymous
            .get(format!("{}/api/share/{id}/download?pwd=nope", app.address))
            .send()
            .await
            .expect("錯的密碼");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    let ok = anonymous
        .get(format!("{}/api/share/{id}/download?pwd=pw", app.address))
        .send()
        .await
        .expect("對的密碼");
    assert!(ok.status().is_success(), "對的密碼要放行");

    // 額度歸零之後，再打錯幾次仍然是 401 而不是 429。
    for _ in 0..3 {
        let res = anonymous
            .get(format!("{}/api/share/{id}/download?pwd=nope", app.address))
            .send()
            .await
            .expect("再錯一次");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "額度應該已經回滿");
    }
}
