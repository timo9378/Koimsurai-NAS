mod common;

use common::spawn_app;
use reqwest::Client;
use serde_json::json;
use uuid::Uuid as _Uuid;

#[tokio::test]
async fn list_files_requires_auth() {
    let app = spawn_app().await;
    let client = Client::new();

    let response = client
        .get(format!("{}/api/files", app.address))
        .send()
        .await
        .expect("Failed to execute request");

    assert_eq!(response.status().as_u16(), 401);
}

#[tokio::test]
async fn list_files_works_with_auth() {
    let app = spawn_app().await;
    let client = Client::builder().cookie_store(true).build().unwrap();

    // Register and Login
    client
        .post(format!("{}/api/auth/register", app.address))
        .json(&json!({
            "username": "testuser",
            "password": "password123",
            "invite_code": common::TEST_INVITE_CODE
        }))
        .send()
        .await
        .expect("Failed to register");

    client
        .post(format!("{}/api/auth/login", app.address))
        .json(&json!({
            "username": "testuser",
            "password": "password123"
        }))
        .send()
        .await
        .expect("Failed to login");

    // Login (cookie-based: access_token will be set as HttpOnly cookie)
    client
        .post(format!("{}/api/auth/login", app.address))
        .json(&json!({
            "username": "testuser",
            "password": "password123"
        }))
        .send()
        .await
        .expect("Failed to login");

    // List files (cookie will be sent automatically)
    let response = client
        .get(format!("{}/api/files", app.address))
        .send()
        .await
        .expect("Failed to execute request");

    assert!(response.status().is_success());
}

/// 建完資料夾**立刻**列目錄就要看得到它。
///
/// ⚠️ `list_files` 讀的是 `files` 表而不是檔案系統，而 `create_folder` 原本
/// 只做 `fs::create_dir_all`，靠 file watcher 非同步補上 DB 那一列。使用者
/// 按下「新增資料夾」之後畫面上什麼也沒發生，過一下才冒出來 —— 而且不會有
/// 任何錯誤。上傳那條路徑一直都有同步寫入，只有建資料夾漏了。
///
/// 這個 race 在 E2E 上表現成間歇性的紅（建完資料夾後等 15 秒仍然找不到桌面
/// 圖示）。本機幾乎重現不出來，CI runner 忙的時候就會。
#[tokio::test]
async fn a_new_folder_is_listed_immediately() {
    let app = spawn_app().await;
    let client = common::register_and_login(&app, "folder_race").await;
    let name = format!("即時-{}", _Uuid::new_v4());

    let res = client
        .post(format!("{}/api/files/folder", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "path": "", "folder_name": name }))
        .send()
        .await
        .expect("create folder");
    assert_eq!(res.status(), reqwest::StatusCode::CREATED);

    // ⚠️ 不要 sleep —— sleep 會讓 file watcher 有機會補上，測試就變成假綠。
    // 要驗的正是「不必等」。
    let listing = client
        .get(format!("{}/api/files", app.address))
        .send()
        .await
        .expect("list")
        .json::<serde_json::Value>()
        .await
        .expect("json");

    let names: Vec<&str> = listing
        .as_array()
        .expect("回應是陣列")
        .iter()
        .filter_map(|f| f["name"].as_str())
        .collect();
    assert!(
        names.contains(&name.as_str()),
        "剛建好的資料夾應該立刻列得出來，實際看到：{names:?}"
    );
}
