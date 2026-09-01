//! `list_files` 的 tags / `is_starred` 批次填充。
//!
//! 為什麼需要這幾條：那兩個欄位原本是在逐檔迴圈裡各打一次 DB（列 N 個項目就是
//! 1 + 2N 次查詢），改成「先一次撈完再對回去」之後，**填錯人**是最可能的失敗模式
//! —— 而既有的 `list_files_works_with_auth` 只斷言回應是 2xx，那種錯它一條都抓不到。
//!
//! 測試資料直接寫進 DB 與磁碟，不走 `create_folder` API：那支是交給 file watcher
//! 非同步索引的，等它進 DB 會讓測試變成計時賽。這裡的測試對象是 `list_files`
//! 本身，不是索引管線。

mod common;

use common::{spawn_app, TestApp, TEST_INVITE_CODE};
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// 註冊 + 登入，回傳帶 cookie 的 client 與該使用者的 id。
async fn setup_user(app: &TestApp) -> (Client, i64) {
    let client = Client::builder()
        .cookie_store(true)
        .build()
        .expect("build client");
    client
        .post(format!("{}/api/auth/register", app.address))
        .json(&json!({
            "username": "batchuser",
            "password": "password123",
            "invite_code": TEST_INVITE_CODE
        }))
        .send()
        .await
        .expect("register");
    client
        .post(format!("{}/api/auth/login", app.address))
        .json(&json!({ "username": "batchuser", "password": "password123" }))
        .send()
        .await
        .expect("login");

    let user_id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
        .bind("batchuser")
        .fetch_one(&app.pool)
        .await
        .expect("查得到剛註冊的使用者");
    (client, user_id)
}

/// 在磁碟建目錄 + 在 `files` 表插一列（`list_files` 兩邊都會看）。
async fn seed_dir(app: &TestApp, name: &str) {
    std::fs::create_dir_all(app.storage_dir.path().join(name)).expect("建立目錄");
    sqlx::query(
        "INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
         VALUES (?, ?, 0, NULL, '', 1, CURRENT_TIMESTAMP)",
    )
    .bind(name)
    .bind(name)
    .execute(&app.pool)
    .await
    .expect("插入 files 列");
}

async fn add_tag(pool: &SqlitePool, user_id: i64, path: &str, tag: &str, color: Option<&str>) {
    sqlx::query("INSERT INTO file_tags (user_id, file_path, tag_name, color) VALUES (?, ?, ?, ?)")
        .bind(user_id)
        .bind(path)
        .bind(tag)
        .bind(color)
        .execute(pool)
        .await
        .expect("插入標籤");
}

async fn add_star(pool: &SqlitePool, user_id: i64, path: &str) {
    sqlx::query("INSERT INTO file_stars (user_id, file_path) VALUES (?, ?)")
        .bind(user_id)
        .bind(path)
        .execute(pool)
        .await
        .expect("插入星號");
}

async fn list_root(client: &Client, address: &str) -> Vec<Value> {
    let res = client
        .get(format!("{address}/api/files"))
        .send()
        .await
        .expect("list");
    assert!(res.status().is_success(), "列目錄失敗: {}", res.status());
    res.json().await.expect("parse json")
}

fn find<'a>(files: &'a [Value], name: &str) -> &'a Value {
    files
        .iter()
        .find(|f| f["name"] == name)
        .unwrap_or_else(|| panic!("清單裡找不到 {name}；實際內容: {files:?}"))
}

#[tokio::test]
async fn tags_and_stars_land_on_the_right_entries() {
    let app = spawn_app().await;
    let (client, user_id) = setup_user(&app).await;

    for name in ["alpha", "beta", "gamma"] {
        seed_dir(&app, name).await;
    }
    // 只有 beta 有標籤、只有 gamma 有星號 —— 對應關係寫錯（全部套第一筆、索引錯位）
    // 都會在這裡現形；只放一個項目的測試則兩種寫法都會過。
    add_tag(&app.pool, user_id, "beta", "work", Some("#ff0000")).await;
    add_star(&app.pool, user_id, "gamma").await;

    let files = list_root(&client, &app.address).await;
    // ⚠️ 刻意不斷言「剛好三筆」：SearchService 會在 storage 底下建 .search_index，
    // 它有沒有被 indexer 掃進清單取決於時序，那是與本測試無關的競態來源。
    // 這裡在意的是「標籤/星號有沒有落在對的項目上」，用 find 逐一查即可。

    let alpha = find(&files, "alpha");
    assert_eq!(
        alpha["tags"].as_array().map(Vec::len),
        Some(0),
        "alpha 不該有標籤"
    );
    assert_eq!(alpha["is_starred"], false, "alpha 不該被加星");

    let beta = find(&files, "beta");
    let beta_tags = beta["tags"].as_array().expect("tags 應為陣列");
    assert_eq!(beta_tags.len(), 1, "beta 應該剛好一個標籤");
    assert_eq!(beta_tags[0]["name"], "work");
    assert_eq!(beta_tags[0]["color"], "#ff0000");
    assert_eq!(beta["is_starred"], false, "beta 不該被加星");

    let gamma = find(&files, "gamma");
    assert_eq!(
        gamma["tags"].as_array().map(Vec::len),
        Some(0),
        "gamma 不該有標籤"
    );
    assert_eq!(gamma["is_starred"], true, "gamma 應該被加星");
}

#[tokio::test]
async fn multiple_tags_on_one_entry_are_all_returned() {
    let app = spawn_app().await;
    let (client, user_id) = setup_user(&app).await;

    seed_dir(&app, "docs").await;
    for tag in ["work", "urgent", "review"] {
        add_tag(&app.pool, user_id, "docs", tag, None).await;
    }

    let files = list_root(&client, &app.address).await;
    let docs = find(&files, "docs");
    let mut names: Vec<&str> = docs["tags"]
        .as_array()
        .expect("tags 應為陣列")
        .iter()
        .map(|t| t["name"].as_str().expect("tag name"))
        .collect();
    names.sort_unstable();
    // 批次版是把多列 group 進同一個 entry，少 group 或互相覆蓋都會在這裡紅
    assert_eq!(names, ["review", "urgent", "work"]);
}

#[tokio::test]
async fn other_users_tags_do_not_leak() {
    let app = spawn_app().await;
    let (client, user_id) = setup_user(&app).await;
    seed_dir(&app, "shared").await;

    add_tag(&app.pool, user_id, "shared", "mine", None).await;

    // 另一個真實使用者（file_tags 有 FK 指向 users，塞假 id 會撞約束）
    let other_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash) VALUES ('someone_else', 'x') RETURNING id",
    )
    .fetch_one(&app.pool)
    .await
    .expect("建立第二個使用者");
    // 他對同一個路徑加的標籤與星號，不該出現在第一個人的清單裡
    add_tag(&app.pool, other_id, "shared", "theirs", None).await;
    add_star(&app.pool, other_id, "shared").await;

    let files = list_root(&client, &app.address).await;
    let shared = find(&files, "shared");
    let tags = shared["tags"].as_array().expect("tags 應為陣列");
    assert_eq!(tags.len(), 1, "只該看到自己的標籤，實際: {tags:?}");
    assert_eq!(tags[0]["name"], "mine");
    assert_eq!(shared["is_starred"], false, "別人加的星號不該算在自己頭上");
}

#[tokio::test]
async fn limit_is_capped_so_a_huge_value_cannot_blow_up_the_query() {
    let app = spawn_app().await;
    let (client, _user_id) = setup_user(&app).await;
    seed_dir(&app, "solo").await;

    // limit 由查詢字串控制，原本沒有上限。夾在 500 之後這個請求應正常回應，
    // 而不是拿 100000 去組 IN 子句（SQLite 綁定參數上限預設 999）。
    let res = client
        .get(format!("{}/api/files?limit=100000", app.address))
        .send()
        .await
        .expect("list with huge limit");
    assert!(
        res.status().is_success(),
        "超大 limit 應被夾住而不是失敗: {}",
        res.status()
    );

    // 同上：只確認目標項目在清單裡，不斷言精確筆數
    let files: Vec<Value> = res.json().await.expect("parse json");
    find(&files, "solo");
}

/// 依名稱排序要對大小寫不敏感。
///
/// ⚠️ SQLite 預設的 BINARY 定序是逐位元組比較，於是大寫全部排在小寫前面：
/// `ABC, Banana, Zebra, abc, apple, cherry` —— `ABC` 跟 `abc` 中間隔著整個
/// 字母表。沒有任何檔案管理器是這樣排的，而這是使用者在一般檢視裡看到的順序。
///
/// （順帶：標籤檢視走的是前端的 `localeCompare`，兩者本來排出完全不同的
/// 順序。這條讓 ASCII 的部分對齊；CJK 仍然是碼位順序，要真正的語言感知
/// 定序得引入 ICU。）
#[tokio::test]
async fn sorting_by_name_is_case_insensitive() {
    let app = spawn_app().await;
    let client = common::register_and_login(&app, "sorter").await;

    // 刻意交錯大小寫
    for name in ["banana.txt", "Apple.txt", "cherry.txt", "ABC.txt", "abc2.txt"] {
        let form = reqwest::multipart::Form::new().part(
            "file",
            reqwest::multipart::Part::bytes(b"x".to_vec()).file_name(name.to_string()),
        );
        let res = client
            .post(format!("{}/api/upload/sortcase", app.address))
            .header("Origin", app.origin_header())
            .multipart(form)
            .send()
            .await
            .expect("upload");
        assert!(res.status().is_success(), "{name} 上傳失敗：{}", res.status());
    }

    let listing: serde_json::Value = client
        .get(format!(
            "{}/api/files/sortcase?sort_by=name&order=asc",
            app.address
        ))
        .send()
        .await
        .expect("list")
        .json()
        .await
        .expect("json");
    let names: Vec<&str> = listing
        .as_array()
        .expect("陣列")
        .iter()
        .filter_map(|f| f["name"].as_str())
        .collect();

    assert_eq!(
        names,
        vec!["ABC.txt", "abc2.txt", "Apple.txt", "banana.txt", "cherry.txt"],
        "大小寫不該把名稱拆開排"
    );
}
