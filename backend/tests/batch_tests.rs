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

/// 批次搬移之後，列表要看得到新位置、看不到舊位置。
///
/// ⚠️ `batch_move` 原本只動磁碟，完全沒碰 `files` 表。而 `GET /api/files`
/// 讀的就是那張表 —— 所以搬完之後**舊位置跟新位置會同時列出同一個檔案**，
/// 舊的那筆點下去 404。改單一檔名的 `rename_file` 一直都有更新，只有批次
/// 這條漏了。
///
/// 資料夾一起測：底下的每一筆都掛著自己的完整 `path`，只改最上層那一列的話，
/// 子項目會留在舊路徑底下。watcher 也補不了 —— 它對舊路徑呼叫的 `remove_file`
/// 只刪目錄自己那一列。
#[tokio::test]
async fn batch_move_updates_the_listing() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "movelist").await;

    let root = app.storage_dir.path();
    std::fs::create_dir(root.join("dst")).expect("mkdir dst");
    std::fs::create_dir_all(root.join("box/inner")).expect("mkdir box");
    std::fs::write(root.join("solo.txt"), b"a").expect("solo");
    std::fs::write(root.join("box/inner/deep.txt"), b"b").expect("deep");

    // 繞過 watcher 直接把索引列建起來 —— 這條測的是「搬移有沒有維護索引」，
    // 不是「索引建不建得起來」。
    for (path, name, parent, is_dir) in [
        ("solo.txt", "solo.txt", "", false),
        ("box", "box", "", true),
        ("box/inner", "inner", "box", true),
        ("box/inner/deep.txt", "deep.txt", "box/inner", false),
    ] {
        sqlx::query(
            "INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
             VALUES (?, ?, 1, 'text/plain', ?, ?, datetime('now'))",
        )
        .bind(path)
        .bind(name)
        .bind(parent)
        .bind(is_dir)
        .execute(&app.pool)
        .await
        .expect("seed files");
    }

    let res = client
        .post(format!("{}/api/files/batch/move", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["solo.txt", "box"], "destination": "dst" }))
        .send()
        .await
        .expect("移動");
    assert_eq!(res.status().as_u16(), 200);

    let names = |body: Value| -> Vec<String> {
        body.as_array()
            .expect("陣列")
            .iter()
            .filter_map(|f| f["name"].as_str().map(str::to_string))
            .collect()
    };

    let at_root = names(
        client
            .get(format!("{}/api/files", app.address))
            .send()
            .await
            .expect("root")
            .json::<Value>()
            .await
            .expect("json"),
    );
    assert!(
        !at_root.contains(&"solo.txt".to_string()),
        "搬走的檔案還留在根目錄的列表裡：{at_root:?}"
    );
    assert!(
        !at_root.contains(&"box".to_string()),
        "搬走的資料夾還留在根目錄的列表裡：{at_root:?}"
    );

    let at_dst = names(
        client
            .get(format!("{}/api/files/dst", app.address))
            .send()
            .await
            .expect("dst")
            .json::<Value>()
            .await
            .expect("json"),
    );
    assert!(
        at_dst.contains(&"solo.txt".to_string()),
        "新位置列不出檔案：{at_dst:?}"
    );
    assert!(
        at_dst.contains(&"box".to_string()),
        "新位置列不出資料夾：{at_dst:?}"
    );

    // 子項目要跟著搬 —— 這一段就是「前綴改寫有沒有做」的斷言。
    let deep = names(
        client
            .get(format!("{}/api/files/dst/box/inner", app.address))
            .send()
            .await
            .expect("inner")
            .json::<Value>()
            .await
            .expect("json"),
    );
    assert!(
        deep.contains(&"deep.txt".to_string()),
        "資料夾搬走了，但底下的東西還掛在舊路徑：{deep:?}"
    );
}

/// 搬移之後，掛在路徑上的東西要跟著走 —— 不只是 `files` 那一列。
///
/// ⚠️ 標籤、星號、權限、分享連結、AI 標記全都是拿字串路徑當外鍵。
/// `rename_file` 一直有更新這六張表，`batch_move` 原本一張都沒有 ——
/// 而修 `batch_move` 的第一版我自己也只補了 `files` 與 `file_tags`，
/// 星號跟分享連結照樣會斷。現在兩條路徑共用 `reindex_moved_path`。
#[tokio::test]
async fn batch_move_carries_stars_and_share_links() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "movelinks").await;

    let root = app.storage_dir.path();
    std::fs::create_dir(root.join("dst")).expect("mkdir dst");
    std::fs::write(root.join("keep.txt"), b"still reachable").expect("來源");

    sqlx::query(
        "INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
         VALUES ('keep.txt', 'keep.txt', 15, 'text/plain', '', 0, datetime('now'))",
    )
    .execute(&app.pool)
    .await
    .expect("seed files");

    let share_id = {
        let res = client
            .post(format!("{}/api/share", app.address))
            .header("Origin", app.origin_header())
            .json(&json!({ "file_path": "keep.txt" }))
            .send()
            .await
            .expect("建立分享連結");
        assert_eq!(res.status().as_u16(), 200);
        let v: Value = res.json().await.expect("json");
        v["id"].as_str().expect("id").to_string()
    };

    let star = client
        .post(format!("{}/api/star/file/keep.txt", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("加星號");
    assert_eq!(star.status().as_u16(), 200, "加星號要成功，不然這條測不到東西");

    let res = client
        .post(format!("{}/api/files/batch/move", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["keep.txt"], "destination": "dst" }))
        .send()
        .await
        .expect("移動");
    assert_eq!(res.status().as_u16(), 200);

    // 分享出去的連結不可以因為擁有者搬了個檔案就 404。
    let dl = client
        .get(format!("{}/api/share/{share_id}/download", app.address))
        .send()
        .await
        .expect("下載");
    assert_eq!(
        dl.status().as_u16(),
        200,
        "搬移之後分享連結斷了 —— share_links 沒有跟著改路徑"
    );
    assert_eq!(dl.text().await.expect("body"), "still reachable");

    let starred: Vec<String> = sqlx::query_scalar("SELECT file_path FROM file_stars")
        .fetch_all(&app.pool)
        .await
        .expect("讀星號");
    assert_eq!(
        starred,
        vec!["dst/keep.txt".to_string()],
        "星號沒有跟著搬，使用者的收藏就這樣指向一個不存在的路徑"
    );
}
