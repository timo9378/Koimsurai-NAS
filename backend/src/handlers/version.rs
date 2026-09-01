use crate::error::AppError;
use crate::state::AppState;
use crate::utils::versioning::{list_versions, FileVersion};
use axum::{
    extract::{Extension, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use tokio::fs;

/// ⚠️ 標註路徑必須跟 `routes/mod.rs` 的真實路由一致。這裡原本寫的是
/// `/api/files/{path}/versions`，而真實路由是 `/api/versions/file/{*path}`
/// —— 跟底下 `restore_version` 當初「三處定義互相矛盾」是同一個毛病。
/// schemathesis 是照 `OpenAPI` 產請求的，spec 對不上就等於這個端點沒被測到。
#[utoipa::path(
    get,
    path = "/api/versions/file/{path}",
    params(
        ("path" = String, Path, description = "檔案路徑（相對於儲存根）")
    ),
    responses(
        (status = 200, description = "List file versions", body = Vec<FileVersion>)
    )
)]
pub async fn list_file_versions(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Result<Json<Vec<FileVersion>>, AppError> {
    let full_path = state.storage_path.resolve(&path)?;

    // We allow listing versions even if the current file is deleted (if we implement that logic later),
    // but for now let's assume we are checking versions of an existing file or at least a path.
    // Actually, validate_path checks for existence if we want to be strict, but here we might want to see versions of a file that was just overwritten.
    // validate_path logic:
    // if full_path.exists() ...

    // If the file doesn't exist, we can still check for versions if we relax validate_path or handle it here.
    // But validate_path returns error if path traversal is detected. It doesn't enforce existence unless we check it.

    let versions = list_versions(&full_path, state.storage_path.as_path()).await?;
    Ok(Json(versions))
}

/// 把某個舊版本還原成目前的檔案。
///
/// ⚠️ 這個端點原本**永遠回 500**，而且是三處定義互相矛盾造成的：
///
/// | | 說的是 |
/// |---|---|
/// | 路由 | `/versions/restore/{version_id}` —— **一個**參數 |
/// | handler | `Path<(String, String)>` —— **兩個** |
/// | utoipa 標註 | `/api/files/{path}/restore/{version_id}` —— 第三種路徑 |
///
/// 實測：`POST /api/versions/restore/abc` →
/// `500 Wrong number of path arguments for Path. Expected 2 but got 1`，
/// 而且 axum 的內部錯誤字串直接送給客戶端。前端的 `useRestoreVersion`
/// 也一直沒送 path（註解寫著「後端好像只要 versionId」）。
///
/// 兩個參數都是必要的：`version_id` 是 `.versions/` 底下的檔名
/// （`<timestamp>_<檔名>`），而父目錄要從目標路徑推。
///
/// ⚠️ 順序是 `{version_id}` 在前、`{*path}` 在後 —— matchit 要求萬用參數
/// 必須是最後一段，而 `Path<(A, B)>` 是**照路由順序**綁定的。
#[utoipa::path(
    post,
    path = "/api/versions/restore/{version_id}/{path}",
    params(
        ("version_id" = String, Path, description = "要還原的版本 ID（.versions 底下的檔名）"),
        ("path" = String, Path, description = "目標檔案路徑，相對於儲存根")
    ),
    responses(
        (status = 200, description = "Version restored"),
        (status = 404, description = "找不到該版本")
    )
)]
pub async fn restore_version(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath((version_id, path)): AxumPath<(String, String)>,
) -> Result<StatusCode, AppError> {
    let full_path = state.storage_path.resolve(&path)?;

    // 1. Locate the version file
    let relative_path = full_path
        .strip_prefix(state.storage_path.as_path())
        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
    // ⚠️ version_id 是 path param（使用者說了算），之前是直接 join 到
    // `.versions/<parent>/`。`StorageRoot` 只保護「根」，從它衍生出來的
    // PathBuf 還是有 join —— 所以這一段要自己走回 resolve。
    let parent = relative_path.parent().unwrap_or_else(|| std::path::Path::new(""));
    let version_path =
        state
            .storage_path
            .resolve(&format!(".versions/{}/{}", parent.to_string_lossy(), version_id))?;

    if !version_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    // 2. Backup current file as a new version (if it exists)
    if full_path.exists() {
        if let Err(e) =
            crate::utils::versioning::create_version(&full_path, state.storage_path.as_path()).await
        {
            tracing::error!("Failed to create version before restore: {:?}", e);
        }
    }

    // 3. Restore (Copy version to current path)
    // We copy instead of move so the version history remains (or we could move and rename, but usually restoring implies "reverting" to that state)
    // Actually, usually "restore" might mean making that version the current one.
    // Let's copy it back.
    fs::copy(&version_path, &full_path)
        .await
        .map_err(AppError::from)?;

    // Audit Log
    let () = state
        .audit
        .log(
            user_id,
            "restore_version",
            &path,
            Some(format!("Restored version: {version_id}")),
            None,
        )
        .await;

    Ok(StatusCode::OK)
}
