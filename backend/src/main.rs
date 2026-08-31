// 見 lib.rs 上方對這條的完整說明（只擋 unwrap、不擋 expect）。
#![deny(clippy::unwrap_used)]

use dotenvy::dotenv;
use std::{env, path::PathBuf};
use tokio::fs;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use Koimsurai_NAS::{create_app, db};

#[tokio::main]
async fn main() {
    dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
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
