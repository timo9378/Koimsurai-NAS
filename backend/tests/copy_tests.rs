mod common;

use common::{register_and_login, spawn_app};
use serde_json::json;

/// 等背景 job 把複製做完。複製是丟進佇列的，回應是 202 而不是「已完成」。
async fn wait_for(path: &std::path::Path, tries: u32) -> bool {
    for _ in 0..tries {
        if path.exists() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    false
}

/// 「貼到同一個資料夾」不可以把原檔清空。
///
/// ⚠️ 這是接上「複製」UI 之前一定要先擋住的洞：job 原本是
/// `dest_path.join(file_name)` 直接給 `fs::copy`。同目錄時來源與目的地是
/// **同一個檔案**，而 `fs::copy` 會先以 truncate 開啟目的地 —— 來源在被讀取
/// 之前就已經空了，「複製」的結果是原檔變成 0 byte。
#[tokio::test]
async fn copying_into_the_same_directory_does_not_destroy_the_original() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "copier").await;

    let root = app.storage_dir.path();
    std::fs::write(root.join("note.txt"), b"original contents").expect("建立檔案");

    let res = client
        .post(format!("{}/api/files/batch/copy", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["note.txt"], "destination": "" }))
        .send()
        .await
        .expect("複製");
    assert!(res.status().is_success(), "複製應該被接受，實際 {}", res.status());

    assert!(
        wait_for(&root.join("note (1).txt"), 30).await,
        "撞名時應該存成 `note (1).txt`"
    );

    let original = std::fs::read_to_string(root.join("note.txt")).expect("原檔還在");
    assert_eq!(original, "original contents", "原檔不可以被清空");

    let copy = std::fs::read_to_string(root.join("note (1).txt")).expect("複本");
    assert_eq!(copy, "original contents", "複本的內容要跟原檔一樣");
}

/// 撞名不可以靜靜覆寫別人的檔案。
#[tokio::test]
async fn copying_onto_an_existing_name_does_not_overwrite_it() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "overwriter").await;

    let root = app.storage_dir.path();
    std::fs::create_dir(root.join("dst")).expect("mkdir");
    std::fs::write(root.join("note.txt"), b"source").expect("來源");
    std::fs::write(root.join("dst/note.txt"), b"do not lose me").expect("目的地既有檔案");

    let res = client
        .post(format!("{}/api/files/batch/copy", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["note.txt"], "destination": "dst" }))
        .send()
        .await
        .expect("複製");
    assert!(res.status().is_success());

    assert!(
        wait_for(&root.join("dst/note (1).txt"), 30).await,
        "應該多一個 `note (1).txt`"
    );

    let existing = std::fs::read_to_string(root.join("dst/note.txt")).expect("既有檔案");
    assert_eq!(existing, "do not lose me", "既有的檔案不可以被覆寫");
}

/// 資料夾不可以被複製到它自己底下 —— `copy_recursive` 會一邊讀一邊往裡面寫。
#[tokio::test]
async fn copying_a_directory_into_itself_is_refused() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "recurser").await;

    let root = app.storage_dir.path();
    std::fs::create_dir_all(root.join("d/inner")).expect("mkdir");
    std::fs::write(root.join("d/inner/a.txt"), b"x").expect("write");

    let res = client
        .post(format!("{}/api/files/batch/copy", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["d"], "destination": "d/inner" }))
        .send()
        .await
        .expect("複製");
    assert!(res.status().is_success(), "請求本身會被接受（複製是排進佇列的）");

    // 給 job 一點時間；它應該**拒絕**而不是開始遞迴。
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    assert!(
        !root.join("d/inner/d/inner/d").exists(),
        "不該遞迴地把自己複製進自己底下"
    );
}
