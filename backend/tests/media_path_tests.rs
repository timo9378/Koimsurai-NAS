//! 媒體端點的路徑處理（`handlers/media.rs`）與上傳檔名（`handlers/upload.rs`）。
//!
//! ⚠️ 這幾個端點都把使用者送來的字串直接 `join` 到 storage 根後面。
//! `Path::join` 不做任何正規化，`..` 會原封不動留在路徑裡，由 OS 在最後
//! 開檔時才解析 —— 中間沒有任何一步會發現它已經走出 storage 了。

mod common;

use common::{register_and_login, spawn_app};
use reqwest::StatusCode;
use serde_json::json;

#[tokio::test]
async fn stream_media_does_not_leak_whether_arbitrary_paths_exist() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "streamer").await;
    app.write_file("ok.bin", b"legit media");

    // ⚠️ 這個端點沒帶 resolution 時**設計上**就回 400（叫你改用 /api/download），
    //    所以 400 與 404 剛好是一個精確的分辨器：
    //      400 = 路徑通過了檢查、走到後面的分支
    //      404 = 路徑被擋下（或檔案不存在）
    //    直接斷言「不是 200」是沒有意義的，因為它本來就不會回 200。
    let probe = |path: &'static str| {
        let client = client.clone();
        let address = app.address.clone();
        async move {
            client
                .get(format!("{address}/api/media/stream"))
                .query(&[("path", path)])
                .send()
                .await
                .expect("request")
                .status()
        }
    };

    assert_eq!(
        probe("ok.bin").await,
        StatusCode::BAD_REQUEST,
        "storage 內的檔案應該通過路徑檢查"
    );
    assert_eq!(probe("沒有這個檔.bin").await, StatusCode::NOT_FOUND);

    // 走出 storage 的路徑必須跟「不存在」無法區分，否則它就是一個
    // 「宿主機上有沒有這個檔案」的探測器。
    for path in [
        "../../../../../../etc/hostname",
        "a/../../../../../../etc/hostname",
    ] {
        assert_eq!(
            probe(path).await,
            StatusCode::NOT_FOUND,
            "{path:?} 應該與「不存在」無法區分"
        );
    }
}

#[tokio::test]
async fn hls_status_does_not_leak_whether_arbitrary_paths_exist() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "prober").await;

    // ⚠️ 這個端點的回應在「檔案存在」與「不存在」時不同，所以只要能餵任意
    //    路徑進去，它就是一個檔案存在性的探測器。
    let res = client
        .get(format!("{}/api/media/hls/status", app.address))
        .query(&[("path", "../../../../../../etc/hostname")])
        .send()
        .await
        .expect("request");
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "走出 storage 的路徑一律當成不存在"
    );
}

#[tokio::test]
async fn upload_file_name_cannot_escape_the_target_directory() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "escapee").await;

    // ⚠️ file_path 有過 validate_path，但 **file_name 沒有**。
    //    完成時 `target_dir.join(&session.file_name)` 會被 rename 過去 ——
    //    也就是一個任意檔案寫入。
    let res = client
        .post(format!("{}/api/upload/init", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": "", "file_name": "../escaped.txt", "total_size": 5 }))
        .send()
        .await
        .expect("init");

    assert!(
        res.status().is_client_error(),
        "帶 `..` 的檔名應該在 init 就被擋下，實際 {}",
        res.status()
    );

    let escaped = app.storage_dir.path().join("../escaped.txt");
    assert!(!escaped.exists(), "不該在 storage 之外留下檔案");
}

#[tokio::test]
async fn a_normal_file_name_still_works() {
    // 正向路徑：只測「該擋的擋住」的話，「全部都擋」也會全綠。
    let app = spawn_app().await;
    let client = register_and_login(&app, "normal_uploader").await;

    let res = client
        .post(format!("{}/api/upload/init", app.address))
        .header("Origin", app.origin_header())
        .json(&json!({ "file_path": "", "file_name": "正常的檔名 (1).txt", "total_size": 5 }))
        .send()
        .await
        .expect("init");
    assert_eq!(res.status(), StatusCode::OK, "一般檔名不該被誤擋");
}

// ══════════════ 大整數參數不能讓 handler panic（schemathesis 找到的）══════════════

/// ⚠️ 這一組全是「已登入使用者送一個大整數就能讓連線被斷」。
/// debug build 會 panic；release 的整數溢位預設是 wrapping，那更難查 ——
/// 不會有症狀，只是算出一個荒謬的 offset。
#[tokio::test]
async fn pagination_survives_extreme_page_and_limit_values() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "paginator").await;

    for (endpoint, params) in [
        ("/api/files", "page=9223372036854775807&limit=9223372036854775807"),
        ("/api/files", "page=-9223372036854775808"),
        ("/api/files", "page=0&limit=0"),
        ("/api/files", "limit=100000"),
        (
            "/api/audit/logs",
            "page=9223372036854775807&limit=9223372036854775807",
        ),
        ("/api/audit/logs", "page=-9223372036854775808"),
        ("/api/audit/logs", "limit=100000"),
    ] {
        let res = client
            .get(format!("{}{endpoint}?{params}", app.address))
            .send()
            .await
            .unwrap_or_else(|e| panic!("{endpoint}?{params} 連線斷掉（handler panic）：{e}"));
        assert!(
            res.status().is_success() || res.status().is_client_error(),
            "{endpoint}?{params} 應該正常回應，實際 {}",
            res.status()
        );
    }
}

#[tokio::test]
async fn an_out_of_range_expiry_does_not_panic_the_handler() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "expiry_abuser").await;

    // ⚠️ `chrono::Duration::seconds` 超出範圍時是 **panic** 而不是回 Err，
    //    而這個值直接來自請求 body。這條跟整數溢位不同：release 也會 panic。
    for endpoint in ["/api/share", "/api/upload-link"] {
        let body = if endpoint == "/api/share" {
            json!({ "file_path": "a.txt", "expires_in_seconds": i64::MAX })
        } else {
            json!({ "target_path": "/", "expires_in_seconds": i64::MAX })
        };
        let res = client
            .post(format!("{}{endpoint}", app.address))
            .header("Origin", app.origin_header())
            .json(&body)
            .send()
            .await
            .unwrap_or_else(|e| panic!("{endpoint} 連線斷掉（handler panic）：{e}"));
        assert!(
            res.status().is_success() || res.status().is_client_error(),
            "{endpoint} 應該正常回應，實際 {}",
            res.status()
        );
    }
}

#[tokio::test]
async fn search_survives_query_syntax_characters() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "searcher").await;

    // ⚠️ tantivy 把輸入當查詢語言解析，`"` `(` `)` `+` `-` `:` 都是運算子。
    //    使用者在搜尋框打一個引號就 500 —— 而且錯誤訊息會原封不動回給前端。
    //    這些全是正常會打進搜尋框的字元。
    for q in [
        "\"",
        "(",
        "a)b",
        "+-",
        "檔案:名稱",
        "AND",
        "報告 (最終版)",
        "50% off",
    ] {
        let res = client
            .get(format!("{}/api/search", app.address))
            .query(&[("q", q)])
            .send()
            .await
            .unwrap_or_else(|e| panic!("q={q:?} 連線斷掉：{e}"));
        assert!(
            !res.status().is_server_error(),
            "q={q:?} 不該回 5xx，實際 {}",
            res.status()
        );
    }
}

#[tokio::test]
async fn a_thumbnail_request_for_a_directory_is_a_clean_404() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "thumber").await;
    std::fs::create_dir_all(app.storage_dir.path().join("資料夾")).expect("mkdir");

    // ⚠️ 目錄也「存在」，交給 ServeFile 的話會宣告 chunked encoding 然後
    //    送不出任何 chunk —— 客戶端拿到「連線中斷」而不是乾淨的 404。
    let res = client
        .get(format!("{}/api/thumbnail/small/資料夾", app.address))
        .send()
        .await
        .expect("目錄的縮圖請求不該讓連線斷掉");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_empty_multipart_filename_is_rejected_without_leaking_os_errors() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "empty_namer").await;

    // ⚠️ `filename=""` 在 multipart 裡是合法編碼。`target_dir.join("")` 會等於
    //    目錄**本身**，接著 File::create 對目錄執行 → EISDIR，原本回
    //    `500 {"error":"Is a directory (os error 21)"}`。
    //    狀態碼是錯的，而且把 OS 錯誤字串送給客戶端。
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(b"x".to_vec()).file_name(""),
    );
    let res = client
        .post(format!("{}/api/upload", app.address))
        .header("Origin", app.origin_header())
        .multipart(form)
        .send()
        .await
        .expect("upload");

    assert!(
        !res.status().is_server_error(),
        "不該是 5xx，實際 {}",
        res.status()
    );
    let body = res.text().await.unwrap_or_default();
    assert!(!body.contains("os error"), "不該把 OS 錯誤字串送出去：{body}");
}
