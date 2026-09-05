//! 垃圾桶還原之後，畫面上要看得到、而且掛在路徑上的東西要跟著回來。
//!
//! ⚠️ 還原原本只 `INSERT` 最上層那一列。這在還原單一檔案時看不出問題，
//! 還原**目錄**時就會變成「磁碟上有、`GET /api/files` 看不到」——
//! 要等 watcher 或下次重啟才補。
//!
//! 撞名是另一半：`available_path` 會把還原的東西放到 `名字 (1).ext`，
//! 而刪除前掛在原路徑上的星號、標籤、分享連結、權限全都留在原路徑，
//! 於是使用者的感受是「還原之後收藏跟分享都不見了」。

mod common;

use common::{register_and_login, spawn_app};
use serde_json::Value;

/// 還原一個資料夾，裡面的東西要立刻列得出來。
#[tokio::test]
async fn restoring_a_directory_reindexes_its_contents() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "restoredir").await;

    let root = app.storage_dir.path();
    std::fs::create_dir_all(root.join("box/inner")).expect("mkdir");
    std::fs::write(root.join("box/inner/deep.txt"), b"deep").expect("deep");

    for (path, name, parent, is_dir) in [
        ("box", "box", "", true),
        ("box/inner", "inner", "box", true),
        ("box/inner/deep.txt", "deep.txt", "box/inner", false),
    ] {
        sqlx::query(
            "INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
             VALUES (?, ?, 4, 'text/plain', ?, ?, datetime('now'))",
        )
        .bind(path)
        .bind(name)
        .bind(parent)
        .bind(is_dir)
        .execute(&app.pool)
        .await
        .expect("seed");
    }

    let del = client
        .delete(format!("{}/api/files/box", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("刪除");
    assert_eq!(del.status().as_u16(), 200);
    let trash_name = del.json::<Value>().await.expect("json")["trash_name"]
        .as_str()
        .expect("trash_name")
        .to_string();

    let restore = client
        .post(format!("{}/api/trash/{trash_name}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("還原");
    assert_eq!(restore.status().as_u16(), 200);

    let listed: Vec<String> = client
        .get(format!("{}/api/files/box/inner", app.address))
        .send()
        .await
        .expect("列表")
        .json::<Value>()
        .await
        .expect("json")
        .as_array()
        .expect("陣列")
        .iter()
        .filter_map(|f| f["name"].as_str().map(str::to_string))
        .collect();

    assert!(
        listed.contains(&"deep.txt".to_string()),
        "資料夾還原了，但裡面的檔案不在列表上：{listed:?}"
    );
}

/// 還原時撞名被改成 `名字 (1).txt`，星號要跟著指到新路徑。
#[tokio::test]
async fn restoring_under_a_new_name_carries_the_star() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "restorestar").await;

    let root = app.storage_dir.path();
    std::fs::write(root.join("fav.txt"), b"original").expect("建檔");
    sqlx::query(
        "INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
         VALUES ('fav.txt', 'fav.txt', 8, 'text/plain', '', 0, datetime('now'))",
    )
    .execute(&app.pool)
    .await
    .expect("seed");

    let star = client
        .post(format!("{}/api/star/file/fav.txt", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("加星號");
    assert_eq!(star.status().as_u16(), 200);

    let del = client
        .delete(format!("{}/api/files/fav.txt", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("刪除");
    assert_eq!(del.status().as_u16(), 200);
    let trash_name = del.json::<Value>().await.expect("json")["trash_name"]
        .as_str()
        .expect("trash_name")
        .to_string();

    // ⚠️ 製造撞名：原路徑上又出現一個同名檔案。沒有這一步，還原路徑就等於
    // 原路徑，關聯資料不搬也會過 —— 那種測試分辨不出有沒有修。
    std::fs::write(root.join("fav.txt"), b"someone else").expect("再建一個同名的");

    let restore = client
        .post(format!("{}/api/trash/{trash_name}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("還原");
    assert_eq!(restore.status().as_u16(), 200);

    assert!(
        root.join("fav (1).txt").exists(),
        "撞名時應該還原成 `fav (1).txt`，這條測試的前提就不成立了"
    );

    let starred: Vec<String> = sqlx::query_scalar("SELECT file_path FROM file_stars")
        .fetch_all(&app.pool)
        .await
        .expect("讀星號");
    assert_eq!(
        starred,
        vec!["fav (1).txt".to_string()],
        "還原被改了名，星號卻還指著舊路徑 —— 使用者的收藏就這樣斷了"
    );
}
