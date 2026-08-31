use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq, Clone, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Pending => "pending",
            Self::Processing => "processing",
            Self::Completed => "completed",
            Self::Failed => "failed",
        })
    }
}

impl From<String> for JobStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "pending" => Self::Pending,
            "processing" => Self::Processing,
            "completed" => Self::Completed,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug, Serialize, FromRow, ToSchema, specta::Type)]
pub struct Job {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub progress: i32,
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
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct JobUpdate {
    pub job_id: String,
    pub status: JobStatus,
    pub progress: i32,
    pub error: Option<String>,
}
