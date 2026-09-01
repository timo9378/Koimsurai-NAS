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
    /// ⚠️ **必須持有**，否則 `TempDir` 在 `spawn_app` 回傳時就被 drop、目錄被刪掉。
    /// 既有連線因為檔案 handle 還開著所以照常運作，但 pool **稍後才惰性開啟的
    /// 新連線**會拿到 `unable to open database file`（SQLite code 14）——
    /// 表現成毫無來由的 500。CPU 受壓時才會走到那條路徑，所以平常跑不出來。
    _db_dir: TempDir,
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

    // ⚠️ 背景 job 的 worker 沒有 AppState，它用 `StorageRoot::from_env()` 自己
    // 重建根路徑。不設這個環境變數的話，worker 會拿預設的 `"storage"`（相對於
    // cwd），跟測試的 TempDir 是兩個不同的地方 —— 於是任何靠 job 完成的斷言
    // 都在觀察一個永遠不會變的目錄，測試會**假綠**（我第一版的複製測試就是
    // 這樣，它「通過」了一條斷言「不該遞迴」，因為那裡根本什麼都沒發生）。
    //
    // nextest 是 process-per-test，所以設 process 層級的環境變數不會互相污染。
    std::env::set_var("STORAGE_PATH", &storage_path);

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
        _db_dir: db_dir,
    }
}

/// 註冊一個帳號並登入，回傳帶著 cookie 的 client。
///
/// ⚠️ 之後用它發**寫入類**請求（POST/PUT/DELETE/PATCH）時**必須**帶 Origin
/// header，否則會拿到 403 而不是預期的結果 —— `middleware/auth.rs` 對
/// cookie 認證的 mutating 請求要求 Origin 或 Referer（CSRF 防護），
/// 而 reqwest 預設兩個都不送。用 `app.origin_header()` 取得正確的值。
#[allow(dead_code, reason = "tests/common 被每個測試 binary 各編一次")]
pub async fn register_and_login(app: &TestApp, username: &str) -> reqwest::Client {
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .expect("build client");

    let res = client
        .post(format!("{}/api/auth/register", app.address))
        .json(&serde_json::json!({
            "username": username,
            "password": "password123",
            "invite_code": TEST_INVITE_CODE,
        }))
        .send()
        .await
        .expect("register");
    assert!(res.status().is_success(), "註冊失敗：{}", res.status());

    let res = client
        .post(format!("{}/api/auth/login", app.address))
        .json(&serde_json::json!({ "username": username, "password": "password123" }))
        .send()
        .await
        .expect("login");
    assert!(res.status().is_success(), "登入失敗：{}", res.status());

    client
}

impl TestApp {
    /// CSRF 檢查會拿 Origin 跟 Host 比對，所以這裡回的是 `http://127.0.0.1:<port>`。
    #[allow(dead_code, reason = "tests/common 被每個測試 binary 各編一次")]
    pub fn origin_header(&self) -> &str {
        &self.address
    }

    /// 在儲存目錄底下建一個檔案，回傳它相對於儲存根的路徑。
    #[allow(dead_code, reason = "tests/common 被每個測試 binary 各編一次")]
    pub fn write_file(&self, relative: &str, contents: &[u8]) -> String {
        let full = self.storage_dir.path().join(relative);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(&full, contents).expect("write file");
        relative.to_string()
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
