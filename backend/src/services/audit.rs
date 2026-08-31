use serde::Serialize;
use sqlx::{Pool, Sqlite};
use utoipa::ToSchema;

pub struct AuditService {
    pool: Pool<Sqlite>,
}

impl AuditService {
    pub const fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn log(
        &self,
        user_id: i64,
        action: &str,
        target: &str,
        details: Option<String>,
        ip_address: Option<String>,
    ) {
        let result = sqlx::query(
            "INSERT INTO audit_logs (user_id, action, target, details, ip_address) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(action)
        .bind(target)
        .bind(details)
        .bind(ip_address)
        .execute(&self.pool)
        .await;

        if let Err(e) = result {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }
}

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema, specta::Type)]
pub struct AuditLog {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    #[specta(type = specta_typescript::Number)]
    pub user_id: i64,
    pub action: String,
    pub target: String,
    pub details: Option<String>,
    pub ip_address: Option<String>,
    // ⚠️ 一定要 `DateTime<Utc>` 而不是 `NaiveDateTime`。
    //
    // `NaiveDateTime` 序列化成 `"2026-08-31T04:53:47"` —— 沒有時區。而
    // JS 的 `new Date()` 對「有 T、無位移」的字串是按**本地時間**解析的
    // （ES2015 起的規範），於是畫面上的時間會整個偏掉一個時區
    // （這台是 Asia/Taipei，差 8 小時）。
    // `DateTime<Utc>` 序列化成 `"...Z"`，兩邊就一致了。
    //
    // schemathesis 的 response_schema_conformance 抓到的：
    // spec 標的是 `format: date-time`（RFC 3339），而無時區的字串不符合。
    #[schema(value_type = String, format = DateTime)]
    pub created_at: chrono::DateTime<chrono::Utc>,
}
