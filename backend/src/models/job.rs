use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq, Clone, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

impl ToString for JobStatus {
    fn to_string(&self) -> String {
        match self {
            Self::Pending => "pending".to_string(),
            Self::Processing => "processing".to_string(),
            Self::Completed => "completed".to_string(),
            Self::Failed => "failed".to_string(),
        }
    }
}

impl From<String> for JobStatus {
    fn from(s: String) -> Self {
        match s.as_str() {
            "pending" => Self::Pending,
            "processing" => Self::Processing,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
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
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct JobUpdate {
    pub job_id: String,
    pub status: JobStatus,
    pub progress: i32,
    pub error: Option<String>,
}