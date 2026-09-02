use crate::models::job::JobUpdate;
use crate::services::ai::AiService;
use crate::services::audit::AuditService;
use crate::services::docker::DockerService;
use crate::services::search::SearchService;
use crate::storage::StorageRoot;
use crate::utils::queue::JobQueue;
use dav_server::DavHandler;
use sqlx::{Pool, Sqlite};
use std::env;
use std::sync::Arc;
use tokio::sync::{broadcast, Semaphore};

/// 從環境變數取得即時轉碼並發限制
/// Get transcode concurrency limit from env
/// 開發機: 2, Server (有 GPU): 4-8
pub fn get_max_concurrent_transcodes() -> usize {
    env::var("MAX_CONCURRENT_TRANSCODES")
        .unwrap_or_else(|_| "2".to_string())
        .parse()
        .unwrap_or(2)
}

/// 從環境變數取得是否啟用 Docker 管理功能
/// Get whether Docker management is enabled from env
pub fn get_docker_enabled() -> bool {
    env::var("ENABLE_DOCKER_MANAGER").is_ok_and(|v| v.to_lowercase() == "true" || v == "1")
}

/// 允許管理 Docker 的使用者 id（`DOCKER_MANAGER_USER_IDS`，逗號分隔）。
///
/// ⚠️ **沒設就是空集合，也就是全部拒絕。**
///
/// 這裡刻意 fail-closed。Docker 管理不是普通功能：容器掛著
/// `/var/run/docker.sock`，能對任意容器 exec 就等於**主機 root**
/// （還能起一個特權容器掛 `/`）。部署時漏設環境變數的後果，
/// 「功能不能用」遠比「每個註冊使用者都拿到主機 root」好。
///
/// 稽核時實測：production 有三個帳號，而在加上這道檢查之前，
/// 三個都能 exec 進任何容器。
pub fn get_docker_manager_user_ids() -> std::collections::HashSet<i64> {
    env::var("DOCKER_MANAGER_USER_IDS")
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect()
}

/// 從環境變數取得是否啟用 AI 圖片標籤功能
/// Get whether AI image labelling is enabled from env
pub fn get_ai_enabled() -> bool {
    env::var("ENABLE_AI_LABELLING").is_ok_and(|v| v.to_lowercase() == "true" || v == "1")
}

#[derive(Clone)]
pub struct AppState {
    pub pool: Pool<Sqlite>,
    pub storage_path: StorageRoot,
    pub queue: Arc<JobQueue>,
    /// tus 1.0.0 的協定 handle（見 handlers/tus.rs）。
    pub tus: Arc<crate::handlers::tus::TusHandle>,
    /// `WebDAV` 的 Basic 認證憑證快取（見 `middleware/basic_auth.rs`）。
    ///
    /// ⚠️ 這不是最佳化。argon2 一次 verify 實測 **310ms**，而 `WebDAV` 客戶端
    /// 展開一層目錄就會發好幾個請求 —— 沒有快取的話功能不能用，
    /// 而且是個「一個請求換 310ms CPU」的 `DoS` 放大器。
    pub basic_auth_cache: crate::middleware::basic_auth::BasicAuthCache,
    /// 公開連結（分享／上傳）的密碼嘗試次數限制。
    ///
    /// ⚠️ 那兩條端點**不需要登入**，而密碼比對走 argon2。沒有這個的話：
    /// 密碼可以無限次暴力嘗試，而且每次嘗試都換走一次 19 MiB + CPU。
    /// 詳見 `utils/throttle.rs`。
    pub link_attempts: Arc<crate::utils::throttle::AttemptLimiter>,
    /// 全站維護作業（rescan、一致性檢查）的單一併發鎖。
    ///
    /// ⚠️ 這兩個端點會走訪**整棵儲存樹**。本專案的紀錄是 320k 個檔案掃一次
    /// 超過 90 秒 —— `create_app` 刻意把初始掃描丟到背景，就是因為
    /// 「掃描期間整個站是掛的」。但那兩個端點是**同步**跑的，而且完全沒有
    /// 併發保護：前端在右鍵選單與 `TopBar` 兩個地方都放了 rescan 按鈕，
    /// 使用者連點兩下、或兩個人同時按，就是兩個並行的全站掃描。
    ///
    /// 用 `try_lock`：已經在跑就回 409，而不是排隊等（排隊只是把 NAS
    /// 榨得更久）。Mutex 的 guard 在 drop 時自動釋放，所以 handler panic
    /// 也不會把鎖卡死。
    pub maintenance_lock: Arc<tokio::sync::Mutex<()>>,
    pub webdav: DavHandler,
    pub tx: broadcast::Sender<JobUpdate>,
    pub audit: Arc<AuditService>,
    pub search: Arc<SearchService>,
    /// JWT 簽名密鑰（啟動時從環境變數讀取，避免每次請求都讀取 env var）
    /// JWT signing secret (loaded once at startup from env var)
    pub jwt_secret: Arc<String>,
    /// Semaphore 用於限制同時進行的 `FFmpeg` 轉碼數量
    /// Semaphore to limit concurrent `FFmpeg` transcodes
    pub transcode_semaphore: Arc<Semaphore>,
    /// Docker 容器管理服務（可選）
    /// Docker container management service (optional)
    pub docker_service: Option<Arc<DockerService>>,
    /// AI 圖片標籤服務（可選）
    /// AI image tagging service (optional)
    pub ai_service: Option<Arc<AiService>>,
    /// 共用的 HTTP client（目前只有錯誤回報轉發在用）。
    /// ⚠️ 一顆共用，不要在 handler 裡 `Client::new()` —— 每次重建會丟掉連線池，
    /// 而且測試也無從注入。只設 `connect_timeout：整體` timeout 由呼叫端逐次決定。
    pub http: reqwest::Client,
}
