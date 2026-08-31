//! 分塊續傳（`handlers/upload.rs`）。
//!
//! ⚠️ 這條路徑的失敗方式全是「安靜地寫壞檔案」：offset 對不上卻照樣接著寫，
//! 結果是一個大小正確、內容錯位的檔案 —— 上傳看起來成功，打開才發現壞了。
//!
//! 導入覆蓋率時這支檔案是 **0%**。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};

/// 開一個上傳工作階段，回傳整包回應。
async fn init(app: &TestApp, client: &Client, dir: &str, name: &str, total: i64) -> (StatusCode, Value) {
    let res = client
        .post(format!("{}/api/upload/init", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": dir, "file_name": name, "total_size": total }))
        .send()
        .await
        .expect("init");
    let status = res.status();
    let body = res.json::<Value>().await.unwrap_or(Value::Null);
    (status, body)
}

/// 送一塊資料。`offset` 為 None 時不帶 offset header（＝不做位移檢查）。
async fn send_chunk(
    app: &TestApp,
    client: &Client,
    id: &str,
    offset: Option<i64>,
    data: &[u8],
) -> StatusCode {
    let mut req = client
        .patch(format!("{}/api/upload/session/{id}", app.address))
        .header("Origin", app.origin_header())
        .header("Content-Type", "application/octet-stream")
        .body(data.to_vec());
    if let Some(o) = offset {
        req = req.header("X-Upload-Offset", o.to_string());
    }
    req.send().await.expect("chunk").status()
}

#[tokio::test]
async fn all_endpoints_require_auth() {
    let app = spawn_app().await;
    let anon = Client::new();

    let res = anon
        .post(format!("{}/api/upload/init", app.address))
        .json(&json!({ "file_path": "", "file_name": "a.txt", "total_size": 1 }))
        .send()
        .await
        .expect("init");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let res = anon
        .get(format!("{}/api/upload/session/whatever", app.address))
        .send()
        .await
        .expect("status");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_single_chunk_upload_lands_on_disk_and_closes_the_session() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "uploader").await;

    let (status, body) = init(&app, &client, "", "note.txt", 5).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "created");
    assert_eq!(body["uploaded_size"], 0);
    let id = body["upload_id"].as_str().expect("upload_id").to_string();

    assert!(send_chunk(&app, &client, &id, Some(0), b"hello")
        .await
        .is_success());

    assert_eq!(
        std::fs::read(app.storage_dir.path().join("note.txt")).expect("read"),
        b"hello"
    );

    // 完成之後 session 應該被刪掉 —— 留著的話下次同名上傳會被誤判成續傳
    let res = client
        .get(format!("{}/api/upload/session/{id}", app.address))
        .send()
        .await
        .expect("status");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn chunks_are_appended_in_order() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "chunker").await;
    let (_, body) = init(&app, &client, "", "big.bin", 9).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    assert!(send_chunk(&app, &client, &id, Some(0), b"abc").await.is_success());
    assert!(send_chunk(&app, &client, &id, Some(3), b"def").await.is_success());
    assert!(send_chunk(&app, &client, &id, Some(6), b"ghi").await.is_success());

    assert_eq!(
        std::fs::read(app.storage_dir.path().join("big.bin")).expect("read"),
        b"abcdefghi"
    );
}

#[tokio::test]
async fn progress_is_reported_between_chunks() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "progress_watcher").await;
    let (_, body) = init(&app, &client, "", "half.bin", 10).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    assert!(send_chunk(&app, &client, &id, Some(0), b"12345")
        .await
        .is_success());

    let session: Value = client
        .get(format!("{}/api/upload/session/{id}", app.address))
        .send()
        .await
        .expect("status")
        .json()
        .await
        .expect("json");
    assert_eq!(session["uploaded_size"], 5);
    assert_eq!(session["total_size"], 10);
}

#[tokio::test]
async fn offset_mismatch_is_rejected_instead_of_silently_appending() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "offset_tester").await;
    let (_, body) = init(&app, &client, "", "gap.bin", 10).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    assert!(send_chunk(&app, &client, &id, Some(0), b"abc").await.is_success());

    // ⚠️ 這是這支測試最重要的一條。少了位移檢查，這塊會被**接在後面**，
    //    得到 "abcXYZ" —— 大小對、內容錯位，而且上傳回報成功。
    assert_eq!(
        send_chunk(&app, &client, &id, Some(7), b"XYZ").await,
        StatusCode::CONFLICT,
        "位移對不上必須拒絕"
    );

    // 重送同一個位置（網路重試的正常情況）也要被擋，否則會重複寫入
    assert_eq!(
        send_chunk(&app, &client, &id, Some(0), b"abc").await,
        StatusCode::CONFLICT,
        "重送已經寫過的位移必須拒絕"
    );

    // 正確的位移照樣能繼續
    assert!(send_chunk(&app, &client, &id, Some(3), b"def").await.is_success());
}

#[tokio::test]
async fn content_range_header_is_honoured_too() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "range_tester").await;
    let (_, body) = init(&app, &client, "", "range.bin", 6).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    // 前端有兩種送位移的方式，兩條路都要驗
    let res = client
        .patch(format!("{}/api/upload/session/{id}", app.address))
        .header("Origin", app.origin_header())
        .header("Content-Range", "bytes 4-6/6")
        .body(b"xx".to_vec())
        .send()
        .await
        .expect("chunk");
    assert_eq!(res.status(), StatusCode::CONFLICT, "Content-Range 的位移也要檢查");
}

#[tokio::test]
async fn reinit_with_the_same_size_resumes_instead_of_restarting() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "resumer").await;
    let (_, body) = init(&app, &client, "", "resume.bin", 10).await;
    let id = body["upload_id"].as_str().expect("id").to_string();
    assert!(send_chunk(&app, &client, &id, Some(0), b"1234")
        .await
        .is_success());

    // 斷線重連：前端會重打 init
    let (status, body) = init(&app, &client, "", "resume.bin", 10).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["upload_id"], id.as_str(), "應該回同一個 session");
    assert_eq!(body["status"], "resuming");
    // ⚠️ uploaded_size 是前端決定從哪裡接續的依據。回錯（或省略）的話
    //    前端會從 0 重傳，而後端是 append 模式 —— 檔案會變成兩倍長。
    assert_eq!(body["uploaded_size"], 4);
}

#[tokio::test]
async fn reinit_with_a_different_size_starts_over() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "size_changer").await;
    let (_, body) = init(&app, &client, "", "changed.bin", 10).await;
    let first = body["upload_id"].as_str().expect("id").to_string();

    // 使用者選了同名但不同內容的檔案
    let (_, body) = init(&app, &client, "", "changed.bin", 20).await;
    assert_ne!(body["upload_id"], first.as_str(), "大小不同就該是新的 session");
    assert_eq!(body["status"], "created");
    assert_eq!(body["uploaded_size"], 0);
}

#[tokio::test]
async fn init_conflicts_when_the_file_already_exists() {
    let app = spawn_app().await;
    app.write_file("existing.txt", b"already here");
    let client = register_and_login(&app, "overwriter").await;

    let (status, _) = init(&app, &client, "", "existing.txt", 5).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "已存在的檔案要回 409，讓前端問使用者要不要覆蓋"
    );
}

#[tokio::test]
async fn a_zero_byte_file_completes() {
    // ⚠️ 前端對空檔案會送**一塊空的** chunk（見 features/files/chunk-plan.ts），
    //    因為不送的話 `new_size >= total_size` 永遠不成立，工作階段會一直開著、
    //    檔案卡在 .temp_uploads，而畫面上顯示上傳成功。
    //    這條釘住後端確實接受那一塊並完成。
    let app = spawn_app().await;
    let client = register_and_login(&app, "empty_file_uploader").await;

    let (_, body) = init(&app, &client, "", "empty.txt", 0).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    assert!(send_chunk(&app, &client, &id, Some(0), b"").await.is_success());
    assert!(
        app.storage_dir.path().join("empty.txt").exists(),
        "空檔案也要落到磁碟上"
    );
    assert_eq!(
        std::fs::read(app.storage_dir.path().join("empty.txt"))
            .expect("read")
            .len(),
        0
    );
}

#[tokio::test]
async fn unknown_session_is_404() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "lost").await;

    let res = client
        .get(format!("{}/api/upload/session/no-such-id", app.address))
        .send()
        .await
        .expect("status");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    assert_eq!(
        send_chunk(&app, &client, "no-such-id", Some(0), b"x").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn init_rejects_dot_dot_in_the_target_directory() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "traverser").await;

    for dir in ["../..", "../../etc", "a/../../b"] {
        let (status, _) = init(&app, &client, dir, "pwned.txt", 1).await;
        assert!(
            status.is_client_error(),
            "{dir:?} 應該被 validate_path 擋下，實際 {status}"
        );
    }
}

#[tokio::test]
async fn an_absolute_target_path_is_treated_as_relative_to_storage() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "absolutist").await;

    // ⚠️ validate_path 的 `Component::RootDir => {}` 是**刻意**忽略開頭斜線：
    //    使用者眼中的 `/etc` 是 NAS 的根目錄，不是宿主機的 /etc。
    //    這條釘住那個語意 —— 有人「順手把絕對路徑一律拒絕」的話會壞掉一半的
    //    前端呼叫（前端送的 path 常常以 / 開頭）。
    let (status, body) = init(&app, &client, "/etc", "note.txt", 4).await;
    assert_eq!(status, StatusCode::OK);
    let id = body["upload_id"].as_str().expect("id").to_string();
    assert!(send_chunk(&app, &client, &id, Some(0), b"safe")
        .await
        .is_success());

    assert!(
        app.storage_dir.path().join("etc/note.txt").exists(),
        "應該落在 storage 底下的 etc/，而不是真的 /etc"
    );
    assert!(!std::path::Path::new("/etc/note.txt").exists());
}

#[tokio::test]
async fn uploading_an_image_queues_a_thumbnail_job_but_a_text_file_does_not() {
    // ⚠️ cargo-mutants 指出來的：決定要不要排縮圖工作的那個
    //    `mime_type.starts_with("image/") || ... || is_likely_media(...)`
    //    三段條件，改成 `&&` 之後沒有任何測試會紅——原本的測試只上傳 .txt/.bin。
    //    壞掉的症狀是「圖片的縮圖永遠不產生」，畫面上就是一格永遠空白，
    //    沒有錯誤訊息。
    let app = spawn_app().await;
    let client = register_and_login(&app, "image_uploader").await;

    // 最小的合法 PNG 檔頭就夠了 —— 這裡驗的是「有沒有排工作」，不是縮圖產得出來
    let png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let (_, body) = init(
        &app,
        &client,
        "",
        "photo.png",
        i64::try_from(png.len()).expect("len"),
    )
    .await;
    let id = body["upload_id"].as_str().expect("id").to_string();
    assert!(send_chunk(&app, &client, &id, Some(0), png).await.is_success());

    let thumb_jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE job_type LIKE '%Thumbnail%'")
        .fetch_one(&app.pool)
        .await
        .expect("query jobs");
    assert_eq!(thumb_jobs, 1, "上傳圖片應該排一個縮圖工作");

    // 反向：純文字不該排
    let (_, body) = init(&app, &client, "", "notes.txt", 5).await;
    let id = body["upload_id"].as_str().expect("id").to_string();
    assert!(send_chunk(&app, &client, &id, Some(0), b"plain")
        .await
        .is_success());

    let thumb_jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE job_type LIKE '%Thumbnail%'")
        .fetch_one(&app.pool)
        .await
        .expect("query jobs");
    assert_eq!(thumb_jobs, 1, "文字檔不該排縮圖工作");
}

#[tokio::test]
async fn a_session_belongs_to_its_creator() {
    let app = spawn_app().await;
    let owner = register_and_login(&app, "owner").await;
    let (_, body) = init(&app, &owner, "", "private.bin", 10).await;
    let id = body["upload_id"].as_str().expect("id").to_string();

    let intruder = register_and_login(&app, "intruder").await;

    // ⚠️ upload_id 是 UUID 所以猜不到，但「猜不到」不是授權。
    //    別人的 session 不該讀得到（會洩漏檔名與路徑），更不該寫得進去
    //    （會把內容摻進別人的檔案裡）。
    let res = intruder
        .get(format!("{}/api/upload/session/{id}", app.address))
        .send()
        .await
        .expect("status");
    assert_eq!(res.status(), StatusCode::NOT_FOUND, "不該讀得到別人的 session");

    assert_eq!(
        send_chunk(&app, &intruder, &id, Some(0), b"injected").await,
        StatusCode::NOT_FOUND,
        "不該寫得進別人的 session"
    );
}
