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
