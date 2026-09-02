use anyhow::Result;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use std::sync::OnceLock;
use tokio::sync::Semaphore;

// 使用 Argon2 加密密碼
// Hash password using Argon2
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e))?
        .to_string();
    Ok(password_hash)
}

// 驗證密碼
// Verify password
pub fn verify_password(password: &str, password_hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(password_hash).map_err(|e| anyhow::anyhow!(e))?;
    let result = Argon2::default().verify_password(password.as_bytes(), &parsed_hash);
    Ok(result.is_ok())
}

// ─── async 包裝：argon2 是純 CPU，不能直接在 async handler 裡跑 ─────────────
//
// 實測（release）：hash 20 ms、verify 18.5 ms。tokio 的 worker 執行緒在這段期間
// 完全不會讓出，同一個 worker 上排隊的其他請求就一起等。8 組 backup code 更是
// 一次 160 ms。
//
// ⚠️ 批次操作要**整批包一次** spawn_blocking，不要在迴圈裡逐次包 —— 那樣每個
// 元素都付一次跨執行緒排程的成本，反而比同步跑還慢。

/// 同時能跑幾個 argon2。
///
/// ⚠️ 這不是效能調校，是**記憶體上限**。`Argon2::default()` 是記憶體硬化的
/// 參數（19 MiB / 次），而 `spawn_blocking` 的池預設 512 條執行緒 ——
/// 沒有這道閘門的話，往公開的分享連結灌併發請求可以逼出接近 10 GB 的配置，
/// 而那些端點**不需要登入**。這台機器就是 NAS 本身，上面還跑著別的服務。
///
/// 排隊比 OOM 好：超過上限的請求會等，不會失敗。
static VERIFY_SLOTS: OnceLock<Semaphore> = OnceLock::new();

fn slots() -> &'static Semaphore {
    VERIFY_SLOTS.get_or_init(|| {
        let cores = std::thread::available_parallelism().map_or(2, std::num::NonZeroUsize::get);
        Semaphore::new(cores.clamp(2, 8))
    })
}

fn spawn_err(e: &tokio::task::JoinError) -> anyhow::Error {
    anyhow::anyhow!("password hashing task failed: {e}")
}

/// 雜湊單一密碼。
pub async fn hash_password_async(password: String) -> Result<String> {
    let _permit = slots().acquire().await?;
    tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|e| spawn_err(&e))?
}

/// 驗證單一密碼。
pub async fn verify_password_async(password: String, password_hash: String) -> Result<bool> {
    let _permit = slots().acquire().await?;
    tokio::task::spawn_blocking(move || verify_password(&password, &password_hash))
        .await
        .map_err(|e| spawn_err(&e))?
}

/// 一次雜湊多筆（2FA 的 backup codes）。整批共用一個 blocking task。
pub async fn hash_all_async(passwords: Vec<String>) -> Result<Vec<String>> {
    let _permit = slots().acquire().await?;
    tokio::task::spawn_blocking(move || {
        passwords
            .iter()
            .map(|p| hash_password(p))
            .collect::<Result<Vec<_>>>()
    })
    .await
    .map_err(|e| spawn_err(&e))?
}

/// 在一組雜湊裡找出第一個吻合的索引（backup code 比對）。整批共用一個 blocking task。
pub async fn find_matching_hash_async(password: String, hashes: Vec<String>) -> Result<Option<usize>> {
    tokio::task::spawn_blocking(move || {
        hashes
            .iter()
            .position(|h| verify_password(&password, h).unwrap_or(false))
    })
    .await
    .map_err(|e| spawn_err(&e))
}
