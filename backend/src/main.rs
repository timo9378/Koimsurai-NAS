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
fn main() {
    dotenv().ok();

    // ⚠️ 這個 guard 一定要活到 main 結束（它在這個 scope 的最後才 drop）。
    // 提早 drop 會把 client 關掉，之後的事件全部靜靜地被丟掉。
    // 名字不加底線前綴：clippy 的 used_underscore_binding 不准讀它，
    // 而下面那行要讀。它有被讀到，所以也不會有 unused 警告。
    let sentry_guard = observability::init();
    // guard 在這裡就決定了，但 tracing 還沒初始化 —— 現在印什麼都會掉。
    // 所以只把「開了沒」帶進去，由 run() 在 subscriber 裝好之後才講。
    let reporting_enabled = sentry_guard.is_some();

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime")
        .block_on(run(reporting_enabled));
}

async fn run(reporting_enabled: bool) {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        // `tracing::error!` → GlitchTip 事件，WARN/INFO → 麵包屑。
        // 這是這次接上之後真正的收穫：後端**已經**在關鍵路徑上寫了
        // `error!`（tus 落地失敗、寫 files 表失敗、覆寫前存版本失敗…），
        // 那些訊息一直都在，只是沒有人看得到。
        .with(sentry_tracing::layer())
        .init();

    // ⚠️ 這行不是裝飾。上報沒開起來是**完全靜默**的 —— DSN 打錯字、scheme 寫成
    // https 卻指向純 HTTP 的內部埠（實際發生過）、環境變數沒帶進容器，
    // 症狀全都一樣：什麼都不會發生，而你以為它在保護你。
    // 其他選用功能（Docker 管理、AI 標籤）開機時都會講一句，這個也要。
    if reporting_enabled {
        tracing::info!("🛰️ 錯誤上報 ENABLED（panic 與 tracing::error! → GlitchTip）");
    } else {
        tracing::info!("🛰️ 錯誤上報 DISABLED（未設 SENTRY_BACKEND_DSN）");
    }

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
