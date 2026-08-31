//! 儲存根目錄的逃逸 —— 「有人忘了呼叫 `validate_path`」這一類。
//!
//! 這支檔案裡的三個漏洞都不是 `validate_path` 寫錯，而是**根本沒經過它**：
//! handler 直接 `state.storage_path.join(使用者輸入)`。型別上這跟正確的寫法
//! 長得一模一樣（兩邊都是 `PathBuf`），所以 code review 一路看不出來 ——
//! `batch_copy` 甚至就緊接在**有**驗證的 `batch_move` 下面。
//!
//! 修法見 `src/storage.rs`：`AppState.storage_path` 不再是 `PathBuf`，
//! 因此 `.join()` 這個動作在這些地方**編譯不過**。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{multipart, redirect::Policy, Client, StatusCode};
use serde_json::{json, Value};
use uuid::Uuid;

const CANARY: &[u8] = b"TOP-SECRET-CANARY-DO-NOT-LEAK";

fn public_client() -> Client {
    Client::builder()
        .redirect(Policy::none())
        .build()
        .expect("build client")
}

/// 在**儲存目錄之外**（它的上一層）放一個誘餌檔，回傳
/// `(從儲存根出發的穿越路徑, 誘餌的絕對路徑)`。
fn plant_canary(app: &TestApp) -> (String, std::path::PathBuf) {
    let name = format!("canary-{}.txt", Uuid::new_v4());
    let outside = app
        .storage_dir
        .path()
        .parent()
        .expect("暫存儲存目錄一定有上層")
        .join(&name);
    std::fs::write(&outside, CANARY).expect("寫誘餌");
    (format!("../{name}"), outside)
}

// ───────────────────────────── 分享連結 ─────────────────────────────

/// `POST /api/share` 把 `file_path` 原封不動存進 DB，`access_share_link`
/// 讀回來只做 `strip_prefix('/')` 就 `join` —— 那對 `..` 毫無作用。
///
/// 影響：一個**一般帳號**就能造出一條讓**任何未登入者**下載任意檔案的公開
/// 連結。真正要命的目標是 SQLite（存著密碼雜湊）跟 `.env`（JWT secret）。
#[tokio::test]
async fn share_link_cannot_read_outside_storage_root() {
    let app = spawn_app().await;
    let (traversal, outside) = plant_canary(&app);
    let client = register_and_login(&app, "share_escaper").await;

    let res = client
        .post(format!("{}/api/share", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": traversal }))
        .send()
        .await
        .expect("create share");

    // 兩種修法都可接受：建立時就擋（400/403），或是下載時擋。
    if res.status() == StatusCode::OK {
        let v: Value = res.json().await.expect("json");
        let id = v["id"].as_str().expect("id").to_string();

        let dl = public_client()
            .get(format!("{}/api/share/{id}/download", app.address))
            .send()
            .await
            .expect("download");
        let status = dl.status();
        let body = dl.bytes().await.expect("body");

        assert_ne!(
            body.as_ref(),
            CANARY,
            "分享連結把儲存根**之外**的檔案原封不動送出來了（狀態 {status}）"
        );
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "穿越路徑的分享應該回 403/404，實際是 {status}"
        );
    }

    // 誘餌本身必須沒被動過，確認測試打的是真的目標。
    assert_eq!(std::fs::read(&outside).expect("誘餌還在"), CANARY);
}

/// 目錄形式更糟：`file_path: ".."` 會讓 `WalkDir` 把整個上層目錄打包成 zip
/// 丟給未登入者 —— 一次帶走資料庫、設定檔跟其他使用者的檔案。
#[tokio::test]
async fn share_link_cannot_zip_parent_directory() {
    let app = spawn_app().await;
    let (_, outside) = plant_canary(&app);
    let client = register_and_login(&app, "zip_escaper").await;

    let res = client
        .post(format!("{}/api/share", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": ".." }))
        .send()
        .await
        .expect("create share");

    if res.status() == StatusCode::OK {
        let v: Value = res.json().await.expect("json");
        let id = v["id"].as_str().expect("id").to_string();

        let dl = public_client()
            .get(format!("{}/api/share/{id}/download", app.address))
            .send()
            .await
            .expect("download");
        let status = dl.status();
        let body = dl.bytes().await.expect("body");

        // zip 用 Stored（不壓縮），所以誘餌內容會原樣出現在 zip 位元組裡。
        assert!(
            !body.windows(CANARY.len()).any(|w| w == CANARY),
            "分享連結打包了儲存根之外的內容（狀態 {status}，{} bytes）",
            body.len()
        );
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "`..` 的分享應該回 403/404，實際是 {status}"
        );
    }

    assert_eq!(std::fs::read(&outside).expect("誘餌還在"), CANARY);
}

// ───────────────────────────── 上傳連結 ─────────────────────────────

/// 這條**完全不需要帳號** —— 只要有一條公開上傳連結存在就行。
///
/// `save_name` 在沒有 `relative_path` 欄位時直接用 `field.file_name()`，
/// 一個字元都沒過濾。multipart 的 `filename` 是客戶端說了算的。
///
/// 這台機器的容器掛了 docker.sock 且 `pid: host`，任意寫檔等於拿下主機。
#[tokio::test]
async fn upload_link_filename_cannot_escape_storage_root() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "link_owner").await;

    let res = client
        .post(format!("{}/api/upload-link", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "target_path": "" }))
        .send()
        .await
        .expect("create link");
    assert_eq!(res.status(), StatusCode::OK);
    let id = res.json::<Value>().await.expect("json")["id"]
        .as_str()
        .expect("id")
        .to_string();

    let name = format!("pwned-{}.txt", Uuid::new_v4());
    let outside = app.storage_dir.path().parent().expect("上層").join(&name);

    let form = multipart::Form::new().part(
        "file",
        multipart::Part::bytes(b"owned".to_vec()).file_name(format!("../{name}")),
    );
    let up = Client::new()
        .post(format!("{}/api/upload-link/{id}/upload", app.address))
        .multipart(form)
        .send()
        .await
        .expect("upload");
    let status = up.status();

    let escaped = outside.exists();
    let _ = std::fs::remove_file(&outside); // 別把垃圾留在 /tmp
    assert!(
        !escaped,
        "未登入的上傳把檔案寫到儲存根之外：{}（狀態 {status}）",
        outside.display()
    );
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "穿越的檔名應該回 400，實際是 {status}"
    );
}

/// 連結建立者也能逃 —— `target_path` 同樣沒驗證。
#[tokio::test]
async fn upload_link_target_path_cannot_escape_storage_root() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "target_escaper").await;

    let res = client
        .post(format!("{}/api/upload-link", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "target_path": ".." }))
        .send()
        .await
        .expect("create link");

    if res.status() == StatusCode::OK {
        let id = res.json::<Value>().await.expect("json")["id"]
            .as_str()
            .expect("id")
            .to_string();

        let name = format!("escaped-{}.txt", Uuid::new_v4());
        let outside = app.storage_dir.path().parent().expect("上層").join(&name);

        let form = multipart::Form::new().part(
            "file",
            multipart::Part::bytes(b"x".to_vec()).file_name(name.clone()),
        );
        let up = Client::new()
            .post(format!("{}/api/upload-link/{id}/upload", app.address))
            .multipart(form)
            .send()
            .await
            .expect("upload");
        let status = up.status();

        let escaped = outside.exists();
        let _ = std::fs::remove_file(&outside);
        assert!(
            !escaped,
            "target_path=\"..\" 讓上傳落在儲存根之外：{}（狀態 {status}）",
            outside.display()
        );
    }
}

// ─────────────────────────── 批次複製 ───────────────────────────

/// `batch_copy` 把 `paths`／`destination` 原樣塞進 job，由 worker
/// `storage_path.join()` —— 它正下方的 `batch_move` 是有驗的。
#[tokio::test]
async fn batch_copy_rejects_escaping_source() {
    let app = spawn_app().await;
    let (traversal, _outside) = plant_canary(&app);
    let client = register_and_login(&app, "copy_escaper").await;

    let res = client
        .post(format!("{}/api/files/batch/copy", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": [traversal], "destination": "" }))
        .send()
        .await
        .expect("batch copy");

    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "來源含 `..` 的批次複製應該當場拒絕，實際是 {}",
        res.status()
    );
}

#[tokio::test]
async fn batch_copy_rejects_escaping_destination() {
    let app = spawn_app().await;
    app.write_file("a.txt", b"hi");
    let client = register_and_login(&app, "copy_dest_escaper").await;

    let res = client
        .post(format!("{}/api/files/batch/copy", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "paths": ["a.txt"], "destination": "../escaped" }))
        .send()
        .await
        .expect("batch copy");

    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "目的地含 `..` 的批次複製應該當場拒絕，實際是 {}",
        res.status()
    );
}

// ─────────────────────────── 垃圾桶 ───────────────────────────

/// `filename` 是 axum 的 path param，而 `Path` 抽取器會**百分比解碼**它 ——
/// `..%2F..%2Fx` 在路由階段是一個 segment，解碼後變成 `../../x`。
/// `permanent_delete` 之前直接 `join(".trash").join(&filename)`，
/// 等於任意刪檔。
#[tokio::test]
async fn trash_delete_cannot_escape_the_trash_directory() {
    let app = spawn_app().await;
    let (_, outside) = plant_canary(&app);
    // ⚠️ 少了這行測試會**假綠**：`.trash` 不存在時，`<storage>/.trash/../../x`
    // 的 stat 在走到穿越之前就先失敗，handler 回 404 而檔案完好無損 ——
    // 測試通過，但什麼也沒驗到。（反向驗證抓出來的。）
    std::fs::create_dir_all(app.storage_dir.path().join(".trash")).expect("建 .trash");
    let client = register_and_login(&app, "trash_escaper").await;

    let encoded = format!(
        "..%2F..%2F{}",
        outside.file_name().expect("檔名").to_string_lossy()
    );
    let res = client
        .delete(format!("{}/api/trash/{encoded}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("delete");

    assert!(
        outside.exists(),
        "垃圾桶的永久刪除把儲存根之外的檔案刪掉了（狀態 {}）",
        res.status()
    );
    let _ = std::fs::remove_file(&outside);
}

/// 還原走的是同一條 `filename`，sink 是 rename。
///
/// 這裡要在 `trash_metadata` 塞一列，讓還原目的地是一個**合法**路徑 ——
/// 否則來源與目的地逃逸的深度不同（`trash_path` 多了 `.trash/` 這一層），
/// rename 會因為目的地不可寫而失敗，測試就變成假綠。
/// 有了這列，逃逸的效果很乾淨：把儲存根之外的檔案搬進使用者自己的目錄，
/// 等於任意讀 + 對原檔的破壞。
#[tokio::test]
async fn trash_restore_cannot_escape_the_trash_directory() {
    let app = spawn_app().await;
    let (_, outside) = plant_canary(&app);
    std::fs::create_dir_all(app.storage_dir.path().join(".trash")).expect("建 .trash");
    let client = register_and_login(&app, "trash_restorer").await;

    let trash_name = format!("../../{}", outside.file_name().expect("檔名").to_string_lossy());
    sqlx::query("INSERT INTO trash_metadata (trash_name, original_path, deleted_by) VALUES (?, ?, 1)")
        .bind(&trash_name)
        .bind("stolen.txt")
        .execute(&app.pool)
        .await
        .expect("插入 trash_metadata");

    let encoded = trash_name.replace('/', "%2F");
    let res = client
        .post(format!("{}/api/trash/{encoded}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("restore");
    let status = res.status();

    let stolen = app.storage_dir.path().join("stolen.txt");
    let leaked = std::fs::read(&stolen).ok();
    assert_ne!(
        leaked.as_deref(),
        Some(CANARY),
        "還原把儲存根之外的檔案搬進了儲存目錄（狀態 {status}）"
    );
    assert_eq!(
        std::fs::read(&outside).ok().as_deref(),
        Some(CANARY),
        "儲存根之外的原檔被搬走了（狀態 {status}）"
    );
    let _ = std::fs::remove_file(&outside);
}
