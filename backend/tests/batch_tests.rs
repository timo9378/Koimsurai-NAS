mod common;

use common::{register_and_login, spawn_app};
use serde_json::{json, Value};

/// 拖放移動撞名時不可以把既有的檔案吃掉。
///
/// ⚠️ `batch_move` 原本是 `dest_path.join(file_name)` 直接 `fs::rename` ——
/// 而 `rename` 在目的地已存在時是**原子性取代**。把 report.pdf 拖進一個
/// 已經有 report.pdf 的資料夾，原本那份就這樣沒了，沒有任何提示。
/// 拖放是這個介面最常用的操作之一。
#[tokio::test]
async fn moving_onto_an_existing_name_does_not_destroy_it() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "mover").await;

    let root = app.storage_dir.path();
    std::fs::create_dir(root.join("dst")).expect("mkdir");
    std::fs::write(root.join("note.txt"), b"incoming").expect("來源");
    std::fs::write(root.join("dst/note.txt"), b"do not lose me").expect("目的地既有檔案");

    let res = client
        .post(format!("{}/api/files/batch/move", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["note.txt"], "destination": "dst" }))
        .send()
        .await
        .expect("移動");
    assert_eq!(res.status().as_u16(), 200);

    let existing = std::fs::read_to_string(root.join("dst/note.txt")).expect("既有檔案還在");
    assert_eq!(existing, "do not lose me", "既有的檔案不可以被覆寫");

    let moved = std::fs::read_to_string(root.join("dst/note (1).txt")).expect("搬過來的那份");
    assert_eq!(moved, "incoming");
    assert!(!root.join("note.txt").exists(), "來源應該已經被搬走");
}

/// 批次刪除要說出「哪些成功、哪些失敗」。
///
/// ⚠️ 原本**永遠回 200**，失敗只進 log。全部刪不掉時前端拿到的也是成功，
/// 於是畫面顯示「已移至垃圾桶」而檔案還在原地。
#[tokio::test]
async fn batch_delete_reports_what_failed() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "batcher").await;

    let root = app.storage_dir.path();
    std::fs::write(root.join("real.txt"), b"x").expect("建立檔案");

    let res = client
        .post(format!("{}/api/files/batch/delete", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["real.txt", "does-not-exist.txt"] }))
        .send()
        .await
        .expect("批次刪除");
    assert_eq!(res.status().as_u16(), 200);

    let body: Value = res.json().await.expect("回應是 JSON");
    let trashed = body["trashed"].as_array().expect("trashed");
    let failed = body["failed"].as_array().expect("failed");

    assert_eq!(trashed.len(), 1, "只有一個真的刪掉了");
    assert_eq!(trashed[0]["path"], "real.txt");
    assert_eq!(trashed[0]["trash_name"], "real.txt", "沒撞名就是原檔名");
    assert_eq!(failed.len(), 1, "另一個要被回報成失敗，而不是靜靜吞掉");
    assert_eq!(failed[0], "does-not-exist.txt");
}

/// 破壞性操作要進稽核紀錄。
///
/// ⚠️ 稽核原本只記四個動作，而批次刪除、永久刪除、清空垃圾桶、還原、
/// 批次移動全都沒有 —— 也就是最需要「誰做的」的那幾件事都查不到。
#[tokio::test]
async fn destructive_operations_are_audited() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "auditee").await;

    let root = app.storage_dir.path();
    std::fs::write(root.join("a.txt"), b"x").expect("建立檔案");

    client
        .post(format!("{}/api/files/batch/delete", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["a.txt"] }))
        .send()
        .await
        .expect("批次刪除");

    client
        .delete(format!("{}/api/trash", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("清空垃圾桶");

    let res = client
        .get(format!("{}/api/audit/logs", app.address))
        .send()
        .await
        .expect("稽核紀錄");
    let logs: Value = res.json().await.expect("JSON");
    let actions: Vec<&str> = logs
        .as_array()
        .expect("陣列")
        .iter()
        .filter_map(|l| l["action"].as_str())
        .collect();

    assert!(
        actions.contains(&"batch_delete"),
        "批次刪除要有紀錄，實際有 {actions:?}"
    );
    assert!(
        actions.contains(&"empty_trash"),
        "清空垃圾桶要有紀錄，實際有 {actions:?}"
    );
}
