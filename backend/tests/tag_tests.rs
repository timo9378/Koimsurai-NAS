//! 標籤（`handlers/tag.rs`）。導入覆蓋率時這支檔案是 **0%**。

mod common;

use common::{register_and_login, spawn_app};
use reqwest::StatusCode;
use serde_json::json;

/// 重複加同一個標籤不該是錯誤。
///
/// ⚠️ `file_tags` 有 `(user_id, file_path, tag_name)` 的 UNIQUE 約束，而
/// 重複加是使用者一定會做的事（點兩下、或兩個分頁各點一次）。原本第二次會
/// 撞 UNIQUE constraint，然後 `AppError::from(sqlx::Error)` 把它變成 500
/// 並把 SQLite 的原始錯誤字串原封不動送出去 —— 狀態碼錯，還洩漏資料表與
/// 欄位名稱。
///
/// （這是 api-fuzz 的種子腳本 `scripts/fuzz_seed.py` 撞出來的：
/// 它對同一個實例重跑第二次時整個掛掉。）
#[tokio::test]
async fn adding_the_same_tag_twice_is_not_an_error() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tagger").await;
    app.write_file("報告.txt", b"x");

    for attempt in 1..=2 {
        let res = client
            .post(format!("{}/api/tags/add/報告.txt", app.address))
            .header("Origin", app.origin_header())
            .json(&json!({ "tag_name": "重要" }))
            .send()
            .await
            .expect("add tag");
        assert_eq!(res.status(), StatusCode::OK, "第 {attempt} 次加標籤應該成功");
    }

    // 而且只會有一個，不是兩個
    let files = client
        .get(format!("{}/api/tags/重要/files", app.address))
        .send()
        .await
        .expect("list")
        .json::<serde_json::Value>()
        .await
        .expect("json");
    let count = files.as_array().map_or(0, Vec::len);
    assert_eq!(count, 1, "同一個檔案不該因為加兩次而出現兩次");
}

#[tokio::test]
async fn tags_require_login() {
    let app = spawn_app().await;
    let res = reqwest::Client::new()
        .post(format!("{}/api/tags/add/x.txt", app.address))
        .json(&json!({ "tag_name": "t" }))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_removed_tag_stops_listing_the_file() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "untagger").await;
    app.write_file("a.txt", b"x");

    client
        .post(format!("{}/api/tags/add/a.txt", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "tag_name": "tmp" }))
        .send()
        .await
        .expect("add");

    let res = client
        .delete(format!("{}/api/tags/remove/tmp/a.txt", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("remove");
    assert_eq!(res.status(), StatusCode::OK);

    let files = client
        .get(format!("{}/api/tags/tmp/files", app.address))
        .send()
        .await
        .expect("list")
        .json::<serde_json::Value>()
        .await
        .expect("json");
    assert_eq!(files.as_array().map_or(1, Vec::len), 0, "移除後不該還列得出來");
}
