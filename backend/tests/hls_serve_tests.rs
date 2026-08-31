//! HLS 檔案服務（`handlers/media.rs` 的 `hls_serve`）。
//!
//! ⚠️ 這個端點會把 `file` 參數接在快取目錄後面然後**直接讀出來回給呼叫端**。
//! 只要包含檢查有破口，它就是一個任意檔案讀取。

mod common;

use common::{register_and_login, spawn_app};
use reqwest::StatusCode;

#[tokio::test]
async fn requires_auth() {
    let app = spawn_app().await;
    let res = reqwest::Client::new()
        .get(format!(
            "{}/api/media/hls/serve?path=a.mp4&file=master.m3u8",
            app.address
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_missing_hls_file_is_404() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "viewer").await;

    let res = client
        .get(format!(
            "{}/api/media/hls/serve?path=a.mp4&file=master.m3u8",
            app.address
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_legitimate_segment_inside_the_cache_is_served() {
    // ⚠️ 正向路徑一定要有：只測「該擋的擋住」的話，「全部都擋」也會全綠 ——
    //    而那會讓整個 HLS 播放功能壞掉，測試卻是綠的。
    let app = spawn_app().await;
    let client = register_and_login(&app, "player").await;

    let cache = app.storage_dir.path().join(".hls_cache").join("e6d48eabd560bc60"); // sha256("a.mp4")[..16]
    std::fs::create_dir_all(cache.join("720p")).expect("mkdir");
    std::fs::write(cache.join("720p/segment_001.ts"), b"TSDATA").expect("write");

    let res = client
        .get(format!("{}/api/media/hls/serve", app.address))
        .query(&[("path", "a.mp4"), ("file", "720p/segment_001.ts")])
        .send()
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"TSDATA");
}

#[tokio::test]
async fn a_symlink_inside_the_cache_cannot_point_outside() {
    // 字面層擋掉 `..` 之後，剩下的逃逸路徑就是符號連結 —— 那是 canonicalize 在管的。
    #[cfg(unix)]
    {
        let app = spawn_app().await;
        let client = register_and_login(&app, "symlinker").await;
        app.write_file("secret.txt", b"TOP SECRET");

        let cache = app.storage_dir.path().join(".hls_cache").join("e6d48eabd560bc60");
        std::fs::create_dir_all(&cache).expect("mkdir");
        std::os::unix::fs::symlink(app.storage_dir.path().join("secret.txt"), cache.join("leak.ts"))
            .expect("symlink");

        let res = client
            .get(format!("{}/api/media/hls/serve", app.address))
            .query(&[("path", "a.mp4"), ("file", "leak.ts")])
            .send()
            .await
            .expect("request");
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        assert!(!body.contains("TOP SECRET"), "符號連結逃逸，狀態 {status}");
    }
}

#[tokio::test]
async fn the_file_parameter_cannot_walk_out_of_the_cache_directory() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "attacker").await;

    // 在 storage 根放一個「機密」檔案。真實情境下目標會是 /etc/passwd
    // 或 backend/.env，這裡用 storage 內的檔案就足以證明能不能走出快取目錄。
    app.write_file("secret.txt", b"TOP SECRET");

    // ⚠️ 這一步不能省，而且是這支測試最容易寫錯的地方。
    //
    // 快取目錄不存在的話，`file_path.exists()` 會因為中間那一段不可走訪而
    // 直接回 false —— 請求得到 404，測試「通過」，但**根本沒走到那道包含檢查**。
    // 我第一版就是這樣：綠燈，而漏洞還在。
    //
    // 生產環境上只要那部影片轉過一次 HLS，這個目錄就存在。所以要重現真實
    // 情境，得先把它建出來。目錄名是 sha256(path) 的前 16 個字元。
    let cache = app.storage_dir.path().join(".hls_cache").join("e6d48eabd560bc60"); // sha256("a.mp4")[..16]
    std::fs::create_dir_all(cache.join("720p")).expect("mkdir cache");
    assert!(cache.exists(), "快取目錄要先存在，否則測不到包含檢查");

    // ⚠️ `Path::starts_with` 是**純字面**比對，不會解析 `..`：
    //    `<cache>/../../secret.txt` 的元件確實以 `<cache>` 的元件開頭，
    //    所以包含檢查會通過，而 `fs::read` 之後 OS 才真的解析 `..`。
    for file in [
        "../../secret.txt",
        "../../../../../../etc/passwd",
        "720p/../../../secret.txt",
    ] {
        let res = client
            .get(format!("{}/api/media/hls/serve", app.address))
            .query(&[("path", "a.mp4"), ("file", file)])
            .send()
            .await
            .expect("request");

        assert_ne!(
            res.status(),
            StatusCode::OK,
            "{file:?} 不該讀得到快取目錄以外的東西"
        );
        let body = res.text().await.unwrap_or_default();
        assert!(
            !body.contains("TOP SECRET") && !body.contains("root:"),
            "{file:?} 讀到了不該讀的內容"
        );
    }
}
