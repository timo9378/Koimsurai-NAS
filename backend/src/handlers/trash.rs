use crate::error::AppError;
use crate::models::FileInfo;
use crate::state::AppState;
use axum::{
    extract::{Extension, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use tokio::fs;

/// Trash file info with `original_path` for frontend restore
#[derive(serde::Serialize)]
pub struct TrashFileInfo {
    pub name: String,
    pub path: String,
    pub original_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub mime_type: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub tags: Vec<crate::models::Tag>,
    pub is_starred: bool,
}

#[utoipa::path(
    get,
    path = "/api/trash",
    responses(
        (status = 200, description = "列出垃圾桶中的檔案 / List trash files", body = Vec<FileInfo>)
    )
)]
pub async fn list_trash(
    State(state): State<AppState>,
    Extension(_user_id): Extension<i64>,
) -> Result<Json<Vec<TrashFileInfo>>, AppError> {
    let trash_path = state.storage_path.internal(".trash");
    if !trash_path.exists() {
        return Ok(Json(vec![]));
    }

    let mut files = Vec::new();
    let mut entries = fs::read_dir(trash_path).await.map_err(AppError::from)?;

    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(metadata) = entry.metadata().await {
            let trash_name = entry.file_name().to_string_lossy().to_string();

            // Look up original path from trash_metadata table
            let original_path: String =
                sqlx::query_scalar("SELECT original_path FROM trash_metadata WHERE trash_name = ?")
                    .bind(&trash_name)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(AppError::from)?
                    .unwrap_or_else(|| trash_name.clone()); // Fallback to name if no metadata (legacy items)

            files.push(TrashFileInfo {
                name: trash_name.clone(),
                path: format!(".trash/{trash_name}"),
                original_path,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs().to_string())
                    .unwrap_or_default(),
                mime_type: None,
                metadata: None,
                tags: vec![],
                is_starred: false,
            });
        }
    }

    Ok(Json(files))
}

#[utoipa::path(
    post,
    path = "/api/trash/{filename}",
    params(
        ("filename" = String, Path, description = "要還原的檔案名 / Filename to restore")
    ),
    responses(
        (status = 200, description = "檔案已還原 / File restored"),
        (status = 404, description = "檔案不存在 / File not found")
    )
)]
pub async fn restore_file(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath(filename): AxumPath<String>,
) -> Result<StatusCode, AppError> {
    // ⚠️ filename 是 axum 的 path param，而 Path 抽取器會解 %2F ——
    // `..%2F..%2Fetc%2Fpasswd` 進得來。之前這裡是直接 join。
    let trash_path = state.storage_path.resolve_under(".trash", &filename)?;

    if !trash_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    // Look up original path from trash_metadata
    let original_path: Option<String> =
        sqlx::query_scalar("SELECT original_path FROM trash_metadata WHERE trash_name = ?")
            .bind(&filename)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    let restore_path = if let Some(ref orig) = original_path {
        // Validate the original path to prevent path traversal
        state.storage_path.resolve(orig)?
    } else {
        // Legacy fallback: restore to root
        state.storage_path.resolve(&filename)?
    };

    // Ensure parent directory exists (it may have been deleted)
    if let Some(parent) = restore_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).await.map_err(AppError::from)?;
        }
    }

    // Handle name collision at restore destination
    // 撞名時挑 `名字 (1).ext`。這段跟複製共用同一個 helper —— 原本兩邊各寫一次，
    // 而這正是這個 codebase 一再出問題的形狀。
    let final_restore_path = {
        let parent = restore_path
            .parent()
            .unwrap_or_else(|| state.storage_path.as_path());
        let desired = restore_path
            .file_name()
            .map_or_else(|| filename.clone(), |n| n.to_string_lossy().to_string());
        crate::utils::naming::available_path(parent, &desired)
    };

    fs::rename(&trash_path, &final_restore_path)
        .await
        .map_err(AppError::from)?;

    // Clean up trash_metadata record
    sqlx::query("DELETE FROM trash_metadata WHERE trash_name = ?")
        .bind(&filename)
        .execute(&state.pool)
        .await
        .map_err(AppError::from)?;

    // Re-index the restored file in the files table
    let relative_path = final_restore_path
        .strip_prefix(state.storage_path.as_path())
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_default();

    if let Ok(meta) = tokio::fs::metadata(&final_restore_path).await {
        if let Ok(modified_time) = meta.modified() {
            let modified = chrono::DateTime::<chrono::Utc>::from(modified_time).naive_utc();
            let name = final_restore_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let parent_path = std::path::Path::new(&relative_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                .unwrap_or_default();
            let mime_type = mime_guess::from_path(&final_restore_path)
                .first_or_octet_stream()
                .to_string();

            let _ = sqlx::query(
                r"
                INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    size = excluded.size,
                    modified = excluded.modified,
                    mime_type = excluded.mime_type
                ",
            )
            .bind(&relative_path)
            .bind(&name)
            .bind(i64::try_from(meta.len()).unwrap_or(i64::MAX))
            .bind(&mime_type)
            .bind(&parent_path)
            .bind(meta.is_dir())
            .bind(modified)
            .execute(&state.pool)
            .await;
        }
    }

    // ⚠️ 還原以前不會被記錄。稽核紀錄原本只有四個動作
    // （create_folder／delete_file／rename_file／restore_version），
    // 而「檔案怎麼跑回來的」跟「誰刪的」一樣需要查。
    let () = state
        .audit
        .log(user_id, "restore_from_trash", &filename, None, None)
        .await;

    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/api/trash",
    responses(
        (status = 200, description = "垃圾桶已清空 / Trash emptied")
    )
)]
pub async fn empty_trash(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
) -> Result<StatusCode, AppError> {
    let trash_path = state.storage_path.internal(".trash");
    if trash_path.exists() {
        fs::remove_dir_all(&trash_path).await.map_err(AppError::from)?;
        fs::create_dir_all(&trash_path).await.map_err(AppError::from)?;
    }
    // ⚠️ 清空垃圾桶是**不可逆**的批次刪除，卻是原本最沒有紀錄的一個。
    let () = state
        .audit
        .log(user_id, "empty_trash", ".trash", None, None)
        .await;

    // Clean all trash metadata
    sqlx::query("DELETE FROM trash_metadata")
        .execute(&state.pool)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    delete,
    path = "/api/trash/{filename}",
    params(
        ("filename" = String, Path, description = "要永久刪除的檔案名 / Filename to permanently delete")
    ),
    responses(
        (status = 200, description = "檔案已永久刪除 / File permanently deleted"),
        (status = 404, description = "檔案不存在 / File not found")
    )
)]
pub async fn permanent_delete(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath(filename): AxumPath<String>,
) -> Result<StatusCode, AppError> {
    // ⚠️ filename 是 axum 的 path param，而 Path 抽取器會解 %2F ——
    // `..%2F..%2Fetc%2Fpasswd` 進得來。之前這裡是直接 join。
    let trash_path = state.storage_path.resolve_under(".trash", &filename)?;

    if !trash_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    if trash_path.is_dir() {
        fs::remove_dir_all(&trash_path).await.map_err(AppError::from)?;
    } else {
        fs::remove_file(&trash_path).await.map_err(AppError::from)?;
    }

    // Clean up trash_metadata record
    sqlx::query("DELETE FROM trash_metadata WHERE trash_name = ?")
        .bind(&filename)
        .execute(&state.pool)
        .await
        .map_err(AppError::from)?;

    let () = state
        .audit
        .log(user_id, "permanent_delete", &filename, None, None)
        .await;

    Ok(StatusCode::OK)
}
