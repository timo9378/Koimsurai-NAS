use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema, specta::Type)]
pub struct InitUploadRequest {
    pub file_path: String, // Target directory
    pub file_name: String,
    #[specta(type = specta_typescript::Number)]
    pub total_size: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, specta::Type)]
pub struct InitUploadResponse {
    pub upload_id: String,
    /// 已上傳的位元組數（若為 resume 則回傳目前已上傳大小）
    #[specta(type = Option<specta_typescript::Number>)]
    pub uploaded_size: Option<i64>,
    /// status: "created" | "resuming"
    pub status: Option<String>,
}

#[derive(Debug, Serialize, FromRow, ToSchema, specta::Type)]
pub struct UploadSession {
    pub id: String,
    #[specta(type = specta_typescript::Number)]
    pub user_id: i64,
    pub file_path: String,
    pub file_name: String,
    #[specta(type = specta_typescript::Number)]
    pub total_size: i64,
    #[specta(type = specta_typescript::Number)]
    pub uploaded_size: i64,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: chrono::NaiveDateTime,
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: chrono::NaiveDateTime,
}
