#![allow(non_snake_case)]
// ⚠️ 這條刻意寫在 crate root 而不是 Cargo.toml 的 `[workspace.lints]`。
//
// `[lints]` 是 **package** 層級的，會連 `tests/` 底下的整合測試一起管，而那不是這條
// 規則的意圖 —— 測試裡 `.unwrap()` 是 assert 語意，壞了就是測試紅，沒有線上影響。
// 寫在 crate root 就精確地只涵蓋正式碼。
//
// 為什麼只擋 unwrap 不擋 expect：
//   `.unwrap()`   = 「我沒想過這裡會不會失敗」
//   `.expect(m)`  = 「我斷言它不會失敗，理由是 m」
// 後者留著當**有文件的**逃生口。導入時正式碼的 25 個 unwrap 這樣分：
//   · search.rs 的 6 個 `get_field("path").unwrap()` —— 改成建構時就存下 Field，
//     不是換成 expect，而是讓它編譯期就不可能失敗
//   · terminal.rs 的 guarded unwrap —— 改用 rsplit_once，guard 與取值合一
//   · media.rs 的 17 個與 routes 的 1 個 —— 換成帶訊息的 expect
#![deny(clippy::unwrap_used)]

pub mod db;
pub mod error;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;
pub mod state;
pub mod storage;
pub mod utils;

use crate::services::ai::AiService;
use crate::services::audit::AuditService;
use crate::services::docker::DockerService;
use crate::services::indexer::Indexer;
use crate::services::search::SearchService;
use crate::state::{get_ai_enabled, get_docker_enabled, get_max_concurrent_transcodes, AppState};
use crate::utils::queue::{worker, JobQueue};
use axum::response::IntoResponse as _;
use dav_server::{localfs::LocalFs, DavHandler};
use sqlx::SqlitePool;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tower::ServiceExt as _;
use tower_http::services::{ServeDir, ServeFile};

pub async fn create_app(pool: SqlitePool, storage_path: PathBuf) -> axum::Router {
    // Initialize Indexer
    let indexer = Arc::new(Indexer::new(pool.clone(), storage_path.clone()));

    // ⚠️ 初始掃描**不能** await —— 它會擋住整個 create_app，伺服器要等掃完才綁 port。
    //
    // 遷移前這只是「掃描期間 API 不通」；SPA 改由後端供應之後，變成「掃描期間整個站
    // 是掛的」。實測 320k 個檔案的掃描跑超過 90 秒還沒結束，而 files 表本來就持久化，
    // 服務期間拿到的是上一輪的結果，不是空的 —— 用短暫的資料稍舊換全站可用，划算得多。
    let indexer_initial = indexer.clone();
    tokio::spawn(async move {
        if let Err(e) = indexer_initial.initial_scan().await {
            tracing::error!("Initial scan failed: {}", e);
        }
    });

    // Spawn file watcher
    let indexer_clone = indexer.clone();
    tokio::spawn(async move {
        if let Err(e) = indexer_clone.run_watcher().await {
            tracing::error!("File watcher failed: {}", e);
        }
    });

    // Initialize Broadcast Channel
    let (tx, _rx) = tokio::sync::broadcast::channel(100);

    // Initialize Job Queue
    let (queue, receiver) = JobQueue::new(100, pool.clone());
    let queue = Arc::new(queue);

    // Initialize Search Service
    let search = Arc::new(SearchService::new(&storage_path).expect("Failed to initialize search service"));

    // Initialize AI Service (可選)
    let ai_service = if get_ai_enabled() {
        tracing::info!("🤖 AI Image Labelling ENABLED");
        let config = AiService::config_from_env();
        tracing::info!(
            "   Model: {}, Min confidence: {}, GPU: {}, Max concurrent: {}",
            config.model_name,
            config.min_confidence,
            config.use_gpu,
            config.max_concurrent_inferences
        );
        Some(Arc::new(AiService::new(pool.clone(), Some(config))))
    } else {
        tracing::info!("🤖 AI Image Labelling DISABLED (set ENABLE_AI_LABELLING=true to enable)");
        None
    };

    // Spawn worker (傳遞 ai_service + storage_path)
    let search_clone = search.clone();
    let ai_clone = ai_service.clone();
    let storage_clone = storage_path.clone();
    tokio::spawn(worker(
        receiver,
        pool.clone(),
        tx.clone(),
        search_clone,
        ai_clone,
        storage_clone,
    ));

    // Initialize WebDAV
    // ⚠️ `strip_prefix` 不能少。沒有它，dav-server 拿到的是**完整**的 URL
    // 路徑（`/webdav/foo`），於是它去找 `<storage>/webdav/foo` —— 整個 `WebDAV`
    // 掛在錯的子目錄上，所有正常請求都 404，而 `/webdav/../x` 反而讀得到
    // 儲存根。功能壞掉與安全漏洞是同一個成因。
    //
    // 必須跟 routes/mod.rs 的掛載路徑一致。
    let webdav = DavHandler::builder()
        .strip_prefix(crate::handlers::webdav::MOUNT_PATH)
        .filesystem(LocalFs::new(storage_path.clone(), false, false, false))
        .locksystem(dav_server::memls::MemLs::new())
        .build_handler();

    // Initialize Audit Service
    let audit = Arc::new(AuditService::new(pool.clone()));

    // Initialize Transcode Semaphore (限制同時轉碼數量)
    let max_transcodes = get_max_concurrent_transcodes();
    tracing::info!("Max concurrent transcodes: {}", max_transcodes);
    let transcode_semaphore = Arc::new(Semaphore::new(max_transcodes));

    // Initialize Docker Service (可選)
    let docker_service = if get_docker_enabled() {
        tracing::info!("🐳 Docker management ENABLED");
        let service = Arc::new(DockerService::new());
        // 嘗試連接到 Docker daemon
        if let Err(e) = service.connect().await {
            tracing::warn!("Failed to connect to Docker daemon: {}. Docker features may not work until manually connected.", e);
        } else {
            tracing::info!("   Successfully connected to Docker daemon");
        }
        Some(service)
    } else {
        tracing::info!("🐳 Docker management DISABLED (set ENABLE_DOCKER_MANAGER=true to enable)");
        None
    };

    // Initialize HLS Cleanup Task
    // 清理 1 小時以上的暫存檔，每 30 分鐘執行一次
    let hls_cache_dir = storage_path.join(".hls_cache");
    let hls_max_age = std::time::Duration::from_secs(
        std::env::var("HLS_CACHE_MAX_AGE_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3600), // 預設 1 小時
    );
    let hls_cleanup_interval = std::time::Duration::from_secs(
        std::env::var("HLS_CLEANUP_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1800), // 預設 30 分鐘
    );

    tracing::info!(
        "🧹 HLS cleanup task: max_age={}s, interval={}s",
        hls_max_age.as_secs(),
        hls_cleanup_interval.as_secs()
    );
    crate::utils::cleanup::spawn_hls_cleanup_task(hls_cache_dir, hls_max_age, hls_cleanup_interval);

    // JWT secret — 啟動時讀取一次，避免每次請求都讀 env var
    let jwt_secret = Arc::new(env::var("JWT_SECRET").expect("JWT_SECRET must be set (checked in main.rs)"));

    // 共用的 HTTP client。只設 connect_timeout —— 整體 timeout 由各呼叫端依用途決定
    // （小的 POST 給明確上限，串流/大檔傳輸不設）。
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("建立 HTTP client 失敗（TLS/系統層損壞才可能）");

    let storage_root = crate::storage::StorageRoot::new(storage_path);

    // tus 的暫存區與狀態存放在 <storage>/.tus。建不出來就讓啟動失敗 ——
    // 靜默降級成「上傳端點在但永遠 500」比直接不啟動更難查。
    let tus = crate::handlers::tus::build(&storage_root)
        .await
        .expect("tus 暫存區建立失敗（磁碟滿了或權限不對）");

    let state = AppState {
        pool,
        storage_path: storage_root,
        queue,
        tus,
        maintenance_lock: Arc::new(tokio::sync::Mutex::new(())),
        webdav,
        tx,
        audit,
        search,
        jwt_secret,
        transcode_semaphore,
        docker_service,
        ai_service,
        http,
    };

    let router = routes::create_router(state).await;
    attach_spa(router)
}

/// 掛上前端 SPA 的靜態檔服務（production：Rust 同時送 API 與前端，零 Node 進程）。
///
/// 目錄不存在就原樣返回 —— dev 由 Vite 供應、測試根本沒有前端產物，
/// 兩者都不該因為少一個目錄而改變行為。
fn attach_spa(router: axum::Router) -> axum::Router {
    let dir = PathBuf::from(env::var("STATIC_DIR").unwrap_or_else(|_| "static".to_string()));
    if !dir.join("index.html").exists() {
        tracing::info!("靜態檔目錄 {} 沒有 index.html，略過 SPA fallback", dir.display());
        return router;
    }
    tracing::info!("📦 SPA 靜態檔由 {} 供應", dir.display());

    // 兩個服務，差別只在「找不到檔案時怎麼辦」：
    //   spa —— 回 index.html，讓 TanStack Router 在前端接手深層路由（/login、/s/:id）
    //   raw —— 直接 404
    // ⚠️ `fallback` 不是 `not_found_service`：後者實測不會替 /login 這類
    //    「路徑不存在」接手，SPA 的深層路由會直接 404。
    let spa = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
    let raw = ServeDir::new(&dir);

    router.fallback(move |req: axum::extract::Request| {
        let spa = spa.clone();
        let raw = raw.clone();
        async move {
            let path = req.uri().path().to_owned();

            // ⚠️ 這幾類路徑未命中時必須回 404，不能落進 SPA fallback：
            //
            //   /api/、/webdav —— 否則前端打錯端點會拿到一份 HTML（200），
            //     然後在 JSON.parse 當場掛掉，比一個乾淨的 404 難查十倍。
            //
            //   /assets/ —— 這裡放的是帶 content hash 的產物。部署後若有陳舊的
            //     index.html 指向舊 hash，回 index.html 等於讓瀏覽器把 HTML 當 JS
            //     執行、得到 `Unexpected token '<'`；回 404 才看得出是資產不見了。
            if path.starts_with("/api/") || path.starts_with("/webdav") {
                return axum::http::StatusCode::NOT_FOUND.into_response();
            }

            let is_asset = path.starts_with("/assets/");
            let svc_result = if is_asset {
                raw.oneshot(req).await
            } else {
                spa.oneshot(req).await
            };
            let mut res = match svc_result {
                Ok(res) => res.into_response(),
                // ServeDir 的 Error 是 Infallible，這條分支永遠走不到
                Err(e) => match e {},
            };

            // Vite 的產物檔名帶 content hash，內容一變檔名就變 —— 可以永久快取。
            // index.html 不能（它是入口，要能立刻指向新的 hash）。
            if is_asset && res.status().is_success() {
                res.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("public, max-age=31536000, immutable"),
                );
            }
            res
        }
    })
}
