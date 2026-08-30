use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::net::TcpListener;
use Koimsurai_NAS::{create_app, db};

/// 測試用的邀請碼
pub const TEST_INVITE_CODE: &str = "test_invite_code_12345";

// ⚠️ `tests/common` 會被編進**每一個**測試 binary，而各測試用到的欄位不同 ——
// 只有 list_files_batch_tests 需要 pool / storage_dir，於是在其他 binary 裡它們
// 就是 dead_code。這是 include 模式的固有現象，不是真的沒人用。
#[allow(dead_code, reason = "tests/common 被每個測試 binary 各編一次，欄位使用者不同")]
pub struct TestApp {
    pub address: String,
    /// 測試可直接用它建資料（例如繞過 file watcher 直接插 `files` 列）
    pub pool: SqlitePool,
    /// 測試需要在磁碟上實際建檔時用（`list_files` 會檢查檔案是否真的存在）
    pub storage_dir: TempDir,
}

pub async fn spawn_app() -> TestApp {
    // 設定測試用的邀請碼環境變數
    std::env::set_var("REGISTRATION_INVITE_CODE", TEST_INVITE_CODE);
    // 設定 JWT secret，避免在測試中呼叫產生或驗證 token 時 panic
    std::env::set_var("JWT_SECRET", "test_jwt_secret_for_tests");
    // 為測試環境關閉 secure cookie 標記，讓 HTTP 測試能讀取 cookie
    std::env::set_var("COOKIE_SECURE", "false");

    // 使用記憶體資料庫進行測試，或者使用暫存檔案
    // 為了確保隔離性，這裡使用暫存檔案資料庫
    let db_dir = TempDir::new().expect("Failed to create temp dir for db");
    let db_path = db_dir.path().join("test.db");
    let database_url = format!("sqlite://{}", db_path.to_str().unwrap());

    // 初始化資料庫
    let pool = db::init_db(Some(database_url))
        .await
        .expect("Failed to initialize database");

    // 建立暫存儲存目錄
    let storage_dir = TempDir::new().expect("Failed to create temp dir for storage");
    let storage_path = storage_dir.path().to_path_buf();

    let app = create_app(pool.clone(), storage_path).await;

    // 綁定到隨機埠口
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind random port");
    let port = listener.local_addr().unwrap().port();
    let address = format!("http://127.0.0.1:{port}");

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    TestApp {
        address,
        pool,
        storage_dir,
    }
}

/// 跟 `spawn_app` 一樣，但額外準備一個最小的靜態檔目錄並設定 `STATIC_DIR`，
/// 用來驗 production 的 SPA 供應路徑（`attach_spa`）。
///
/// ⚠️ 靠 nextest「一個測試一個行程」才安全 —— `set_var` 是 process 全域的。
/// `cargo test` 下同行程平行跑會互相蓋，那也是本專案不用 cargo test 的理由之一。
#[allow(dead_code, reason = "只有 spa_serving_tests 這個 binary 會用到")]
pub async fn spawn_app_with_static() -> TestApp {
    let static_dir = TempDir::new().expect("Failed to create temp dir for static");
    std::fs::write(
        static_dir.path().join("index.html"),
        "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    )
    .expect("write index.html");
    std::fs::create_dir_all(static_dir.path().join("assets")).expect("mkdir assets");
    std::fs::write(static_dir.path().join("assets/app-abc123.js"), "console.log(1)").expect("write asset");

    std::env::set_var("STATIC_DIR", static_dir.path());
    let app = spawn_app().await;
    // TempDir 要活到測試結束，否則目錄會被刪掉；掛在 TestApp 上一起活著。
    std::mem::forget(static_dir);
    app
}
