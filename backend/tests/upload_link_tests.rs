//! 上傳連結（`handlers/upload_link.rs`）。
//!
//! ⚠️ 這是整個後端**唯一免身分就能寫入檔案**的端點。守衛（密碼、過期、
//! 檔案數上限、單檔大小上限、路徑穿越）任何一道破掉，都不會有任何症狀 ——
//! 功能照常運作，只是任何人都能往這台機器寫東西。
//!
//! 導入覆蓋率時這支檔案是 **0%**。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{multipart, Client, StatusCode};
use serde_json::{json, Value};

/// 建一個上傳連結，回傳它的 id。
async fn create_link(app: &TestApp, client: &Client, body: Value) -> String {
    let res = client
        .post(format!("{}/api/upload-link", app.address))
        .header("Origin", app.origin_header())
        .json(&body)
        .send()
        .await
        .expect("create upload link");
    assert_eq!(res.status(), StatusCode::OK, "建立上傳連結應成功");
    let v: Value = res.json().await.expect("json");
    v["id"].as_str().expect("回應要有 id").to_string()
}

/// 匿名地把一個檔案送進上傳連結。
async fn upload(app: &TestApp, id: &str, query: &str, name: &str, bytes: Vec<u8>) -> reqwest::Response {
    let form = multipart::Form::new().part("file", multipart::Part::bytes(bytes).file_name(name.to_string()));
    Client::new()
        .post(format!("{}/api/upload-link/{id}/upload{query}", app.address))
        .multipart(form)
        .send()
        .await
        .expect("upload")
}

#[tokio::test]
async fn create_requires_auth() {
    let app = spawn_app().await;
    let res = Client::new()
        .post(format!("{}/api/upload-link", app.address))
        .json(&json!({ "target_path": "/" }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "未登入不該建得出上傳連結");
}

#[tokio::test]
async fn anonymous_upload_lands_in_the_target_folder() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "uploader").await;
    let id = create_link(&app, &client, json!({ "target_path": "收件匣" })).await;

    // info 不需要登入
    let info: Value = Client::new()
        .get(format!("{}/api/upload-link/{id}/info", app.address))
        .send()
        .await
        .expect("info")
        .json()
        .await
        .expect("json");
    assert_eq!(info["target_folder"], "收件匣");
    assert_eq!(info["is_password_protected"], false);
    assert_eq!(info["uploaded_count"], 0);

    let res = upload(&app, &id, "", "note.txt", b"hi".to_vec()).await;
    assert!(res.status().is_success(), "匿名上傳應成功：{}", res.status());

    let landed = app.storage_dir.path().join("收件匣/note.txt");
    assert!(landed.exists(), "檔案應該落在目標資料夾");
    assert_eq!(std::fs::read(&landed).expect("read"), b"hi");
}

#[tokio::test]
async fn unknown_link_is_404() {
    let app = spawn_app().await;
    let res = Client::new()
        .get(format!("{}/api/upload-link/nope/info", app.address))
        .send()
        .await
        .expect("info");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let res = upload(&app, "nope", "", "x.txt", b"x".to_vec()).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn password_is_enforced_on_upload_but_not_on_info() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "pwd_uploader").await;
    let id = create_link(
        &app,
        &client,
        json!({ "target_path": "/", "password": "open-sesame" }),
    )
    .await;

    let info: Value = Client::new()
        .get(format!("{}/api/upload-link/{id}/info", app.address))
        .send()
        .await
        .expect("info")
        .json()
        .await
        .expect("json");
    assert_eq!(info["is_password_protected"], true, "info 要誠實地說有密碼");

    assert_eq!(
        upload(&app, &id, "", "a.txt", b"a".to_vec()).await.status(),
        StatusCode::UNAUTHORIZED,
        "沒帶密碼不該寫得進來"
    );
    assert_eq!(
        upload(&app, &id, "?pwd=wrong", "a.txt", b"a".to_vec())
            .await
            .status(),
        StatusCode::UNAUTHORIZED,
        "密碼錯不該寫得進來"
    );
    // ⚠️ 少了這條，「把密碼檢查整段拿掉」也能讓上面兩條……不，會讓上面兩條紅。
    //    但「檢查永遠回 401」會讓上面兩條綠而這條紅 —— 兩個方向都要蓋。
    assert!(
        upload(&app, &id, "?pwd=open-sesame", "a.txt", b"a".to_vec())
            .await
            .status()
            .is_success(),
        "密碼對了就該成功"
    );
}

#[tokio::test]
async fn expired_link_rejects_both_info_and_upload() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "expired_uploader").await;
    let id = create_link(
        &app,
        &client,
        json!({ "target_path": "/", "expires_in_seconds": -60 }),
    )
    .await;

    let res = Client::new()
        .get(format!("{}/api/upload-link/{id}/info", app.address))
        .send()
        .await
        .expect("info");
    assert_eq!(res.status(), StatusCode::GONE);
    assert_eq!(
        upload(&app, &id, "", "a.txt", b"a".to_vec()).await.status(),
        StatusCode::GONE
    );
}

#[tokio::test]
async fn max_files_limit_blocks_further_uploads() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "count_uploader").await;
    let id = create_link(&app, &client, json!({ "target_path": "/", "max_files": 1 })).await;

    assert!(
        upload(&app, &id, "", "first.txt", b"1".to_vec())
            .await
            .status()
            .is_success(),
        "第一個檔案應該進得來"
    );
    assert_eq!(
        upload(&app, &id, "", "second.txt", b"2".to_vec()).await.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "超過上限的那個應該被擋"
    );
    assert!(
        !app.storage_dir.path().join("second.txt").exists(),
        "被擋下的檔案不該留在磁碟上"
    );
}

#[tokio::test]
async fn max_files_zero_blocks_everything() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "zero_uploader").await;
    // ⚠️ 0 是合法的上限值（＝完全不准傳）。用真假值判斷的話 0 會被當成
    //    「沒有限制」而全部放行 —— 前端也踩過同一個坑（見 routes/u.$id.tsx）。
    let id = create_link(&app, &client, json!({ "target_path": "/", "max_files": 0 })).await;

    assert_eq!(
        upload(&app, &id, "", "nope.txt", b"x".to_vec()).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[tokio::test]
async fn oversized_file_is_rejected_and_not_left_on_disk() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "size_uploader").await;
    let id = create_link(&app, &client, json!({ "target_path": "/", "max_file_size": 10 })).await;

    assert!(
        upload(&app, &id, "", "small.txt", vec![b'a'; 5])
            .await
            .status()
            .is_success(),
        "沒超過上限的應該成功"
    );

    let res = upload(&app, &id, "", "big.txt", vec![b'a'; 100]).await;
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    // ⚠️ 這條跟狀態碼一樣重要：檢查是在**串流過程中**做的，所以檔案已經
    //    被建立、寫了一部分。沒有清乾淨的話磁碟上會留下一個截斷的檔案。
    assert!(
        !app.storage_dir.path().join("big.txt").exists(),
        "超過上限的檔案應該被刪掉，不能留下半截"
    );
}

#[tokio::test]
async fn relative_path_cannot_escape_the_target_folder() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "traversal_uploader").await;
    let id = create_link(&app, &client, json!({ "target_path": "收件匣" })).await;

    // ⚠️ relative_path 是**使用者送的**（資料夾上傳時每個檔案前面一個）。
    //    `../` 沒有被過濾掉的話，任何人都能往儲存根以外的地方寫檔案。
    let form = multipart::Form::new()
        .text("relative_path", "../../../etc/pwned.txt")
        .part(
            "file",
            multipart::Part::bytes(b"owned".to_vec()).file_name("pwned.txt"),
        );
    let res = Client::new()
        .post(format!("{}/api/upload-link/{id}/upload", app.address))
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success(), "會被清理而不是報錯");

    // 清理之後應該落在目標資料夾底下，而不是跑到外面
    let escaped = app.storage_dir.path().join("../../../etc/pwned.txt");
    assert!(!escaped.exists(), "不該寫到儲存根之外");
    assert!(
        app.storage_dir.path().join("收件匣/etc/pwned.txt").exists(),
        "`..` 應該被過濾掉，剩下的路徑接在目標資料夾底下"
    );
}

#[tokio::test]
async fn folder_upload_keeps_the_directory_structure() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "folder_uploader").await;
    let id = create_link(&app, &client, json!({ "target_path": "收件匣" })).await;

    let form = multipart::Form::new()
        .text("relative_path", "專案/src/main.rs")
        .part(
            "file",
            multipart::Part::bytes(b"fn main() {}".to_vec()).file_name("main.rs"),
        );
    let res = Client::new()
        .post(format!("{}/api/upload-link/{id}/upload", app.address))
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success());

    assert!(
        app.storage_dir.path().join("收件匣/專案/src/main.rs").exists(),
        "資料夾上傳要保留階層"
    );
}
