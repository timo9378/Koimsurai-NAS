//! tus 1.0.0 端點（`handlers/tus.rs`）。
//!
//! 這裡驗兩件事：
//!   1. 協定本身照規格走（OPTIONS/POST/HEAD/PATCH/DELETE、offset 對不上要 409）
//!   2. **落地路徑走 `StorageRoot::resolve`** —— `Upload-Metadata` 是客戶端
//!      說了算的，而這個 repo 已經修過六個「把使用者輸入 join 到儲存根後面」
//!      的逃逸漏洞。新開的寫入端點一定要在導入當下就把這條釘住。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, StatusCode};
use uuid::Uuid;

const TUS: &str = "/api/tus";

/// tus 的 metadata 值是標準 base64。
fn b64(s: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b = s.as_bytes();
    let mut out = String::new();
    for c in b.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (c.get(1).map_or(0, |x| u32::from(*x)) << 8)
            | c.get(2).map_or(0, |x| u32::from(*x));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 建一個上傳，回傳它的 id。
async fn create(app: &TestApp, client: &Client, len: usize, metadata: &str) -> String {
    let res = client
        .post(format!("{}{TUS}", app.address))
        .header("Origin", app.origin_header())
        .header("Tus-Resumable", "1.0.0")
        .header("Upload-Length", len.to_string())
        .header("Upload-Metadata", metadata)
        .send()
        .await
        .expect("create");
    assert_eq!(res.status(), StatusCode::CREATED, "建立上傳應回 201");
    let loc = res
        .headers()
        .get("location")
        .expect("要有 Location 標頭")
        .to_str()
        .expect("location utf8")
        .to_string();
    loc.rsplit('/').next().expect("id").to_string()
}

async fn patch(app: &TestApp, client: &Client, id: &str, offset: usize, body: &[u8]) -> reqwest::Response {
    client
        .patch(format!("{}{TUS}/{id}", app.address))
        .header("Origin", app.origin_header())
        .header("Tus-Resumable", "1.0.0")
        .header("Upload-Offset", offset.to_string())
        .header("Content-Type", "application/offset+octet-stream")
        .body(body.to_vec())
        .send()
        .await
        .expect("patch")
}

#[tokio::test]
async fn options_advertises_the_protocol() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_options").await;

    let res = client
        .request(reqwest::Method::OPTIONS, format!("{}{TUS}", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("options");

    assert_eq!(
        res.headers().get("tus-resumable").and_then(|v| v.to_str().ok()),
        Some("1.0.0")
    );
    let ext = res
        .headers()
        .get("tus-extension")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(ext.contains("creation"), "要宣告 creation 擴充，實際：{ext}");
    assert!(
        ext.contains("termination"),
        "要宣告 termination 擴充，實際：{ext}"
    );
}

#[tokio::test]
async fn requires_login() {
    let app = spawn_app().await;
    let res = Client::new()
        .post(format!("{}{TUS}", app.address))
        .header("Tus-Resumable", "1.0.0")
        .header("Upload-Length", "3")
        .send()
        .await
        .expect("create");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "未登入不該建得出上傳");
}

#[tokio::test]
async fn full_upload_lands_in_storage() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_full").await;
    let name = format!("報告-{}.txt", Uuid::new_v4());
    let body = b"hello tus, this is the whole file";

    let id = create(&app, &client, body.len(), &format!("filename {}", b64(&name))).await;

    // 分兩塊傳，中途查一次進度 —— 續傳的意義就在這裡
    let half = body.len() / 2;
    let r1 = patch(&app, &client, &id, 0, &body[..half]).await;
    assert_eq!(r1.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        r1.headers().get("upload-offset").and_then(|v| v.to_str().ok()),
        Some(half.to_string().as_str())
    );

    let head = client
        .request(reqwest::Method::HEAD, format!("{}{TUS}/{id}", app.address))
        .header("Tus-Resumable", "1.0.0")
        .send()
        .await
        .expect("head");
    assert_eq!(
        head.headers().get("upload-offset").and_then(|v| v.to_str().ok()),
        Some(half.to_string().as_str()),
        "HEAD 要回得出已經傳到哪 —— 那是續傳的前提"
    );

    let r2 = patch(&app, &client, &id, half, &body[half..]).await;
    assert_eq!(r2.status(), StatusCode::NO_CONTENT);

    let landed = app.storage_dir.path().join(&name);
    assert!(
        landed.exists(),
        "上傳完成後檔案應該落在儲存根：{}",
        landed.display()
    );
    assert_eq!(std::fs::read(&landed).expect("read"), body, "內容要一字不差");
}

#[tokio::test]
async fn metadata_path_puts_the_file_in_a_subfolder() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_subdir").await;
    let body = b"in a folder";

    let id = create(
        &app,
        &client,
        body.len(),
        &format!("path {},filename {}", b64("Documents/2026"), b64("note.txt")),
    )
    .await;
    assert_eq!(
        patch(&app, &client, &id, 0, body).await.status(),
        StatusCode::NO_CONTENT
    );

    let landed = app.storage_dir.path().join("Documents/2026/note.txt");
    assert!(landed.exists(), "應該落在子目錄：{}", landed.display());
}

/// ⚠️ 這條是重點。`Upload-Metadata` 完全由客戶端決定，而落地是**寫檔**。
#[tokio::test]
async fn metadata_filename_cannot_escape_storage_root() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_escape").await;
    let name = format!("pwned-{}.txt", Uuid::new_v4());
    let outside = app.storage_dir.path().parent().expect("上層").join(&name);
    let body = b"owned";

    let id = create(
        &app,
        &client,
        body.len(),
        &format!("filename {}", b64(&format!("../{name}"))),
    )
    .await;
    let res = patch(&app, &client, &id, 0, body).await;
    let status = res.status();

    let escaped = outside.exists();
    let _ = std::fs::remove_file(&outside);
    assert!(
        !escaped,
        "tus 的落地把檔案寫到儲存根之外：{}（狀態 {status}）",
        outside.display()
    );
}

/// `path` 那個鍵也一樣 —— 兩個鍵是分開解的，只擋一個等於沒擋。
#[tokio::test]
async fn metadata_path_cannot_escape_storage_root() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_escape_dir").await;
    let name = format!("escaped-{}.txt", Uuid::new_v4());
    let outside = app.storage_dir.path().parent().expect("上層").join(&name);
    let body = b"owned";

    let id = create(
        &app,
        &client,
        body.len(),
        &format!("path {},filename {}", b64(".."), b64(&name)),
    )
    .await;
    let res = patch(&app, &client, &id, 0, body).await;
    let status = res.status();

    let escaped = outside.exists();
    let _ = std::fs::remove_file(&outside);
    assert!(
        !escaped,
        "path 元資料逃出了儲存根：{}（狀態 {status}）",
        outside.display()
    );
}

#[tokio::test]
async fn wrong_offset_is_409_not_silent_corruption() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_offset").await;
    let body = b"0123456789";
    let id = create(
        &app,
        &client,
        body.len(),
        &format!("filename {}", b64("offset.txt")),
    )
    .await;

    assert_eq!(
        patch(&app, &client, &id, 0, &body[..4]).await.status(),
        StatusCode::NO_CONTENT
    );

    // 客戶端以為自己在 0，其實伺服器在 4。照規格要 409 —— 不能默默接受，
    // 那會讓檔案內容錯位而且沒有人發現。
    let res = patch(&app, &client, &id, 0, &body[..4]).await;
    assert_eq!(res.status(), StatusCode::CONFLICT, "offset 對不上要回 409");
}

#[tokio::test]
async fn missing_tus_resumable_header_is_412() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_version").await;

    let res = client
        .post(format!("{}{TUS}", app.address))
        .header("Origin", app.origin_header())
        .header("Upload-Length", "3")
        .send()
        .await
        .expect("create");
    assert_eq!(
        res.status(),
        StatusCode::PRECONDITION_FAILED,
        "沒有 Tus-Resumable 要回 412"
    );
}

#[tokio::test]
async fn terminate_removes_an_unfinished_upload() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_terminate").await;
    let id = create(&app, &client, 100, &format!("filename {}", b64("abandoned.bin"))).await;

    let res = client
        .delete(format!("{}{TUS}/{id}", app.address))
        .header("Origin", app.origin_header())
        .header("Tus-Resumable", "1.0.0")
        .send()
        .await
        .expect("delete");
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let head = client
        .request(reqwest::Method::HEAD, format!("{}{TUS}/{id}", app.address))
        .header("Tus-Resumable", "1.0.0")
        .send()
        .await
        .expect("head");
    assert_eq!(head.status(), StatusCode::NOT_FOUND, "刪掉之後再查應該是 404");
}

/// tus 覆寫既有檔案之前要先存一份版本。
///
/// ⚠️ 舊的分塊上傳（`handlers/upload.rs`）一直都會在覆寫前呼叫
/// `create_version`，而 tus 這條沒有 —— 同一個動作（上傳一個已經存在的檔名）
/// 在兩條路徑上行為不同，而 tus 是現在的**主要**路徑。`File::create` 是
/// truncate，舊內容直接消失且沒有任何備份。
#[tokio::test]
async fn overwriting_via_tus_keeps_a_version_of_the_old_content() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "tus_overwriter").await;

    let name = "overwrite.txt";
    std::fs::write(app.storage_dir.path().join(name), b"old contents").expect("既有檔案");

    let id = create(
        &app,
        &client,
        b"new contents".len(),
        &format!("filename {},path {}", b64(name), b64("")),
    )
    .await;
    assert!(patch(&app, &client, &id, 0, b"new contents")
        .await
        .status()
        .is_success());

    let current = std::fs::read_to_string(app.storage_dir.path().join(name)).expect("新內容");
    assert_eq!(current, "new contents", "檔案本身要換成新的");

    // `.versions/<父目錄>/<timestamp>_<檔名>`；父目錄是根，所以直接在 .versions 底下。
    let versions_dir = app.storage_dir.path().join(".versions");
    let saved: Vec<String> = std::fs::read_dir(&versions_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(name))
        .map(|e| std::fs::read_to_string(e.path()).unwrap_or_default())
        .collect();

    assert!(
        saved.iter().any(|c| c == "old contents"),
        "覆寫前的內容要留在 .versions 裡，實際找到 {saved:?}"
    );
}
