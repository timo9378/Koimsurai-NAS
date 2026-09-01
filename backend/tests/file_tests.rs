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

/// 刪除必須回傳**垃圾桶裡的實際檔名**。
///
/// `.trash` 是扁平的，撞名時 `move_to_trash` 會改存成 `原名.<timestamp>`。
/// 前端刪除後會跳一個「復原」的 toast，而它原本傳的是 `file.name` ——
/// 只要同名檔案被刪過第二次，那個復原就會 404。production 的垃圾桶裡
/// 現在就有三個帶時間戳的項目，這條路徑是真的會走到的。
#[tokio::test]
async fn deleting_a_name_twice_returns_the_suffixed_trash_name() {
    let app = spawn_app().await;
    let client = common::register_and_login(&app, "trash_collider").await;

    let delete_once = |body: &'static str| {
        let client = client.clone();
        let address = app.address.clone();
        let dir = app.storage_dir.path().to_path_buf();
        async move {
            std::fs::write(dir.join("dup.txt"), body).expect("建立檔案");
            let res = client
                .delete(format!("{address}/api/files/dup.txt"))
                .header("Origin", &address)
                .send()
                .await
                .expect("刪除");
            assert_eq!(res.status().as_u16(), 200, "刪除應該成功");
            let body: serde_json::Value = res.json().await.expect("回應是 JSON");
            body["trash_name"]
                .as_str()
                .expect("回應要有 trash_name")
                .to_string()
        }
    };

    let first = delete_once("第一次").await;
    assert_eq!(first, "dup.txt", "第一次沒撞名，就是原檔名");

    let second = delete_once("第二次").await;
    assert_ne!(second, "dup.txt", "第二次撞名了，不會再是原檔名");
    assert!(
        second.starts_with("dup.txt."),
        "撞名後的格式是 `原名.<timestamp>`，實際拿到 {second}"
    );

    // 這是整個測試的重點：拿原檔名去復原，復原的是**第一次**刪的那份，
    // 第二次刪的檔案會留在垃圾桶裡 —— 使用者按了「復原」卻沒有復原他剛刪的東西。
    // 拿回傳的 trash_name 才會對。
    let res = client
        .post(format!("{}/api/trash/{second}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("復原");
    assert_eq!(res.status().as_u16(), 200, "用回傳的 trash_name 復原應該成功");

    let restored = std::fs::read_to_string(app.storage_dir.path().join("dup.txt")).expect("檔案回來了");
    assert_eq!(restored, "第二次", "復原的要是最後刪掉的那一份");
}
