// 見 lib.rs 上方對這條的完整說明（只擋 unwrap、不擋 expect）。
#![deny(clippy::unwrap_used)]

use dotenvy::dotenv;
use std::{env, path::PathBuf};
use tokio::fs;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use Koimsurai_NAS::{create_app, db, observability};

/// ⚠️ 這裡**刻意不用** `#[tokio::main]`。
///
/// sentry 的預設 transport 會建一個 `reqwest` 的 blocking client，而在 tokio
/// runtime 的執行緒裡建 blocking client 會 panic
/// （「Cannot drop a runtime in a context where blocking is not allowed」）。
/// 所以順序必須是：先 `sentry::init`，再建 runtime。
///
/// ⚠️ `_guard` 要活到 `main` 結束。提早 drop 會把 client 關掉，之後的事件
/// 全部靜靜地被丟掉 —— 不會有任何錯誤告訴你。
fn main() {
    dotenv().ok();

    let _guard = observability::init();

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime")
        .block_on(run());
}

async fn run() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        // `tracing::error!` → GlitchTip 事件，WARN/INFO → 麵包屑。
        // 這是這次接上之後真正的收穫：後端**已經**在關鍵路徑上寫了
        // `error!`（tus 落地失敗、寫 files 表失敗、覆寫前存版本失敗…），
        // 那些訊息一直都在，只是沒有人看得到。
        .with(sentry_tracing::layer())
        .init();

    // Fail-fast if JWT_SECRET is not configured — prevents runtime login errors.
    if std::env::var("JWT_SECRET").is_err() {
        tracing::error!(
            "JWT_SECRET environment variable is not set. Set it in your environment or .env file."
        );
        std::process::exit(1);
    }

    // 初始化資料庫
    // Initialize DB
    let pool = db::init_db(None).await.expect("Failed to initialize database");

    // 初始化儲存目錄
    // Initialize storage
    let storage_path_str = env::var("STORAGE_PATH").unwrap_or_else(|_| "storage".to_string());
    let storage_path = PathBuf::from(storage_path_str);
    if !storage_path.exists() {
        fs::create_dir_all(&storage_path)
            .await
            .expect("Failed to create storage directory");
    }

    let app = create_app(pool, storage_path).await;

    // ⚠️ 連接埠可用 PORT 覆寫。預設 3000 是容器裡的固定值（compose 對外
    // 映射 127.0.0.1:3000），但本機要另外起一個實例（例如跑 schemathesis
    // 對 API 做 fuzz）時，寫死的話會直接撞到正在服務的那個。
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let bind_addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| panic!("無法綁定 {bind_addr}（連接埠被佔用或權限不足）：{e}"));
    tracing::info!("RustNAS Server running on http://{bind_addr}");
    axum::serve(listener, app).await.expect("HTTP server 異常結束");
}
