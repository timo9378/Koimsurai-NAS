use crate::utils::metadata::FileMetadata;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema, specta::Type)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[specta(type = specta_typescript::Number)]
    pub size: u64,
    pub modified: String,
    pub mime_type: Option<String>,
    pub metadata: Option<FileMetadata>,
    pub tags: Vec<Tag>,
    pub is_starred: bool,
}

#[derive(Serialize, ToSchema, Debug, Clone, specta::Type)]
pub struct Tag {
    pub name: String,
    pub color: Option<String>,
}
