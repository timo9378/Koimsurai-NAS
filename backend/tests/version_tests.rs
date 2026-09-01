//! 檔案版本（`handlers/version.rs`）。導入覆蓋率時這支檔案是 **0%**。
//!
//! ⚠️ `restore_version` 原本**永遠回 500**，三處定義互相矛盾：
//! 路由說一個參數、handler 抽兩個、utoipa 標註寫的是第三種路徑。
//! 而 0% 覆蓋率**不是「沒人測」而是「進不去」** —— 測試連函式本體都到不了。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, StatusCode};

/// 上傳同一個檔名兩次來製造一個版本（第二次寫入前會把舊的存成版本）。
async fn upload(app: &TestApp, client: &Client, name: &str, body: &'static [u8]) {
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(body).file_name(name.to_string()),
    );
    let res = client
        .post(format!("{}/api/upload", app.address))
        .header("Origin", app.origin_header())
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success(), "上傳失敗：{}", res.status());
}

#[tokio::test]
async fn listing_versions_of_an_untouched_file_is_empty_not_an_error() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "versions_empty").await;
    upload(&app, &client, "solo.txt", b"only version").await;

    let res = client
        .get(format!("{}/api/versions/file/solo.txt", app.address))
        .send()
        .await
        .expect("list");
    assert_eq!(res.status(), StatusCode::OK);
    let v: serde_json::Value = res.json().await.expect("json");
    assert_eq!(v.as_array().map_or(1, Vec::len), 0, "沒被覆寫過的檔案不該有版本");
}

/// 覆寫一次之後，舊的內容要留成一個版本，而且**還原得回去**。
///
/// ⚠️ 這條在修好路由之前根本跑不起來 —— `POST` 會拿到
/// `500 Wrong number of path arguments`。
#[tokio::test]
async fn a_version_can_be_listed_and_restored() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "versions").await;

    upload(&app, &client, "報告.txt", b"first version").await;
    upload(&app, &client, "報告.txt", b"second version").await;

    let versions: serde_json::Value = client
        .get(format!("{}/api/versions/file/報告.txt", app.address))
        .send()
        .await
        .expect("list")
        .json()
        .await
        .expect("json");
    let list = versions.as_array().expect("陣列");
    assert!(!list.is_empty(), "覆寫之後應該留下一個版本，實際：{versions}");

    let version_id = list[0]["version_id"].as_str().expect("version_id");
    let res = client
        .post(format!(
            "{}/api/versions/restore/{}/報告.txt",
            app.address,
            urlencoding::encode(version_id)
        ))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("restore");
    assert_eq!(res.status(), StatusCode::OK, "還原應該成功");

    // 磁碟上的內容要變回舊的
    assert_eq!(
        std::fs::read(app.storage_dir.path().join("報告.txt")).expect("read"),
        b"first version",
        "還原之後檔案內容應該是舊版本"
    );
}

#[tokio::test]
async fn restoring_a_version_that_does_not_exist_is_404() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "versions_404").await;
    upload(&app, &client, "a.txt", b"x").await;

    let res = client
        .post(format!("{}/api/versions/restore/1234_a.txt/a.txt", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("restore");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

/// `version_id` 是使用者說了算的，不能拿來爬出 `.versions/`。
#[tokio::test]
async fn version_id_cannot_escape_the_versions_directory() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "versions_escape").await;
    upload(&app, &client, "target.txt", b"original").await;
    app.write_file("secret.txt", b"SECRET");

    let res = client
        .post(format!(
            "{}/api/versions/restore/{}/target.txt",
            app.address,
            urlencoding::encode("../../secret.txt")
        ))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("restore");

    assert_ne!(res.status(), StatusCode::OK, "穿越的 version_id 不該成功");
    assert_eq!(
        std::fs::read(app.storage_dir.path().join("target.txt")).expect("read"),
        b"original",
        "目標檔案不該被別的檔案覆蓋"
    );
}
