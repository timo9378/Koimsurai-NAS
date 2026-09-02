use crate::error::AppError;
use crate::models::{CreateShareLinkRequest, ShareLinkResponse};
use crate::state::AppState;
use crate::utils::hash::{hash_password_async, verify_password_async};
use axum::{
    body::Body,
    extract::{Extension, Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;

/// `SELECT file_path, password_hash, expires_at`
type ShareAccessRow = (String, Option<String>, Option<chrono::DateTime<Utc>>);
/// `SELECT file_path, password_hash, expires_at, created_at`
type ShareInfoRow = (
    String,
    Option<String>,
    Option<chrono::DateTime<Utc>>,
    chrono::DateTime<Utc>,
);

use chrono::{Duration, Utc};
use std::path::Path;
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct ShareQuery {
    pub pwd: Option<String>,
}

/// 分享連結元數據響應
#[derive(Serialize, utoipa::ToSchema, specta::Type)]
pub struct ShareInfoResponse {
    pub id: String,
    pub file_name: String,
    #[specta(type = specta_typescript::Number)]
    pub file_size: u64,
    pub mime_type: Option<String>,
    pub is_directory: bool,
    pub is_password_protected: bool,
    pub expires_at: Option<String>,
    pub created_at: String,
}

#[utoipa::path(
    post,
    path = "/api/share",
    request_body = CreateShareLinkRequest,
    responses(
        // ⚠️ 實際回的是 200 不是 201（handler 回 `Json<T>`，axum 的預設狀態碼是 200）。
        // schemathesis 的 status_code_conformance 抓到的。
        (status = 200, description = "Share link created", body = ShareLinkResponse)
    )
)]
pub async fn create_share_link(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateShareLinkRequest>,
) -> Result<Json<ShareLinkResponse>, AppError> {
    // ⚠️ 這裡不驗的話，`file_path` 會原封不動進 DB，然後被
    // `access_share_link` 拿去 join —— 一個一般帳號就能造出讓**任何未登入者**
    // 下載儲存根之外任意檔案的公開連結。真正的目標是 SQLite（密碼雜湊）
    // 跟 .env（JWT secret）。存取端也會再驗一次（DB 裡可能有舊資料）。
    state.storage_path.resolve(&payload.file_path)?;

    let id = Uuid::new_v4().to_string();
    let password_hash = if let Some(pwd) = payload.password {
        Some(hash_password_async(pwd.clone()).await.map_err(AppError::from)?)
    } else {
        None
    };

    // ⚠️ `Duration::seconds` 在超出範圍時會 **panic**（不是回 Err）——
    // 而 expires_in_seconds 直接來自請求 body。送一個夠大的數字就能讓這個
    // handler 掛掉、連線被斷。這個跟整數溢位不同：release build 也一樣會 panic。
    // 用 try_seconds，超範圍就當成「沒有設定過期時間」。
    let expires_at = payload
        .expires_in_seconds
        .and_then(|s| Duration::try_seconds(s).map(|d| Utc::now() + d));

    sqlx::query(
        "INSERT INTO share_links (id, file_path, password_hash, expires_at, creator_id) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&payload.file_path)
    .bind(password_hash)
    .bind(expires_at)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(ShareLinkResponse {
        id: id.clone(),
        url: format!("/s/{id}"),
        expires_at: expires_at.map(|t| t.to_rfc3339()),
    }))
}

/// 只檢查密碼，不產生任何內容。
///
/// ⚠️ 這個端點存在的理由是**前端沒辦法知道密碼對不對**。分享頁用原生的
/// `<a download>` 觸發下載（大檔案唯一可靠的做法），而瀏覽器不會把 401 交回
/// 頁面 —— 使用者打錯密碼時畫面上完全沒有反應，現在多了 429 更需要講清楚。
///
/// 不用「先 fetch 一次再下載」是因為資料夾分享會**即時打包成 zip**：
/// 探測一次等於多壓一次整個資料夾。
#[utoipa::path(
    get,
    path = "/api/share/{id}/verify",
    params(("id" = String, Path, description = "分享連結 id"), ("pwd" = Option<String>, Query, description = "密碼")),
    responses(
        (status = 200, description = "密碼正確，或這個連結沒有設密碼"),
        (status = 401, description = "缺少或錯誤的密碼"),
        (status = 404, description = "連結不存在"),
        (status = 410, description = "連結已過期"),
        (status = 429, description = "嘗試太多次，稍後再試")
    ),
    tag = "share"
)]
pub async fn verify_share_password(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<ShareQuery>,
) -> Result<StatusCode, AppError> {
    let row: Option<(String, Option<String>, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as("SELECT file_path, password_hash, expires_at FROM share_links WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    let (_, password_hash, expires_at) = row.ok_or(AppError::Status(StatusCode::NOT_FOUND))?;

    if let Some(exp) = expires_at {
        if exp < chrono::Utc::now() {
            return Err(AppError::Status(StatusCode::GONE));
        }
    }

    let Some(hash) = password_hash else {
        return Ok(StatusCode::OK);
    };

    // 額度檢查在 argon2 之前 —— 跟 access_share_link 同一個限制器、同一個理由。
    if !state.link_attempts.allows(&id) {
        return Err(AppError::Status(StatusCode::TOO_MANY_REQUESTS));
    }

    let Some(pwd) = query.pwd else {
        return Err(AppError::Status(StatusCode::UNAUTHORIZED));
    };

    if verify_password_async(pwd, hash).await.map_err(AppError::from)? {
        state.link_attempts.reset(&id);
        Ok(StatusCode::OK)
    } else {
        state.link_attempts.record_failure(&id);
        Err(AppError::Status(StatusCode::UNAUTHORIZED))
    }
}

#[utoipa::path(
    get,
    path = "/api/share/{id}/download",
    params(
        ("id" = String, Path, description = "Share ID"),
        ShareQuery
    ),
    responses(
        (status = 200, description = "Download file"),
        (status = 401, description = "Password required or invalid"),
        (status = 404, description = "Link not found or expired")
    )
)]
pub async fn access_share_link(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<ShareQuery>,
) -> Result<impl IntoResponse, AppError> {
    let row: Option<ShareAccessRow> =
        sqlx::query_as("SELECT file_path, password_hash, expires_at FROM share_links WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    let (file_path_str, password_hash, expires_at) = row.ok_or(AppError::Status(StatusCode::NOT_FOUND))?;

    // Check expiry
    //
    // ⚠️ cargo-mutants 會把這個 `>` 換成 `>=` 而測不出差別 —— 那是**等價變異**，
    // 不要追。兩者只在 `now` 與 `expiry` 奈秒級剛好相等時不同，寫不出能分辨
    // 的輸入。同樣的情形在 upload_link.rs 有兩處。
    if let Some(expiry) = expires_at {
        if Utc::now() > expiry {
            return Err(AppError::Status(StatusCode::NOT_FOUND));
        }
    }

    // Check password
    if let Some(hash) = password_hash {
        // ⚠️ 額度檢查要在 argon2 **之前**。這條端點不需要登入，而每一次驗證
        // 都是 19 MiB + CPU —— 擋在後面的話，被擋掉的請求仍然付了那個代價，
        // 等於沒擋。見 `utils/throttle.rs`。
        if !state.link_attempts.allows(&id) {
            return Err(AppError::Status(StatusCode::TOO_MANY_REQUESTS));
        }

        let Some(pwd) = query.pwd else {
            return Err(AppError::Status(StatusCode::UNAUTHORIZED));
        };
        let valid = verify_password_async(pwd, hash.clone())
            .await
            .map_err(AppError::from)?;
        if !valid {
            state.link_attempts.record_failure(&id);
            return Err(AppError::Status(StatusCode::UNAUTHORIZED));
        }
        // 對了就把額度還回去 —— 不然一個打錯幾次才輸對的人會被後續請求誤鎖。
        state.link_attempts.reset(&id);
    }

    // ⚠️ 這裡讀的是 DB 欄位，但那不代表可信 —— 舊資料可能是在建立端加上驗證
    // 之前寫進去的。`strip_prefix('/')` 對 `..` 完全沒有作用。
    let clean_path = file_path_str.strip_prefix('/').unwrap_or(&file_path_str);
    let full_path = state.storage_path.resolve(&file_path_str)?;

    // Check path exists
    if !full_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    let is_directory = full_path.is_dir();

    if is_directory {
        // === Directory: create zip and stream ===
        let dir_name = Path::new(clean_path)
            .file_name()
            .map_or_else(|| "download".to_string(), |n| n.to_string_lossy().to_string());
        let zip_file_name = format!("{dir_name}.zip");

        let temp_path = std::env::temp_dir().join(format!("nas_share_{}.zip", Uuid::new_v4()));
        let full_path_for_zip = full_path.clone();
        let temp_path_for_zip = temp_path.clone();

        // Create zip in blocking task
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            let file = std::fs::File::create(&temp_path_for_zip)
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
            let mut zip = zip::ZipWriter::new(file);
            let options =
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

            for entry in WalkDir::new(&full_path_for_zip).follow_links(false) {
                let entry = entry.map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
                let path = entry.path();
                let relative = path
                    .strip_prefix(&full_path_for_zip)
                    .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;

                if relative.as_os_str().is_empty() {
                    continue; // Skip root directory itself
                }

                if path.is_dir() {
                    let dir_path = format!("{}/", relative.to_string_lossy());
                    zip.add_directory(&dir_path, options)
                        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
                } else if path.is_file() {
                    zip.start_file(relative.to_string_lossy().to_string(), options)
                        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
                    let mut f = std::fs::File::open(path)
                        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
                    std::io::copy(&mut f, &mut zip)
                        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
                }
            }

            zip.finish()
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
            Ok(())
        })
        .await
        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))??;

        // Open the temp zip, then unlink it (Linux keeps data accessible via fd)
        let zip_file = tokio::fs::File::open(&temp_path)
            .await
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        let zip_metadata = zip_file
            .metadata()
            .await
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        let zip_size = zip_metadata.len();

        // Remove temp file; on Linux the open fd keeps data accessible
        tokio::fs::remove_file(&temp_path).await.ok();

        let encoded_name = urlencoding::encode(&zip_file_name);
        let disposition = format!(
            "attachment; filename=\"{}\"; filename*=UTF-8''{}",
            zip_file_name.replace('"', "\\\""),
            encoded_name
        );

        let stream = ReaderStream::new(zip_file);
        let body = Body::from_stream(stream);

        let response = axum::http::Response::builder()
            .header("Content-Type", "application/zip")
            .header("Content-Length", zip_size)
            .header("Content-Disposition", &disposition)
            .header("Cache-Control", "private, no-cache")
            .body(body)
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;

        Ok(response)
    } else {
        // === Single file: stream directly ===
        let file = tokio::fs::File::open(&full_path)
            .await
            .map_err(|_| AppError::Status(StatusCode::NOT_FOUND))?;
        let metadata = file
            .metadata()
            .await
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        let file_size = metadata.len();

        let file_name = Path::new(clean_path)
            .file_name()
            .map_or_else(|| "download".to_string(), |n| n.to_string_lossy().to_string());

        let mime_type = mime_guess::from_path(&full_path)
            .first_or_octet_stream()
            .to_string();

        let encoded_name = urlencoding::encode(&file_name);
        let disposition = format!(
            "attachment; filename=\"{}\"; filename*=UTF-8''{}",
            file_name.replace('"', "\\\""),
            encoded_name
        );

        let stream = ReaderStream::new(file);
        let body = Body::from_stream(stream);

        let response = axum::http::Response::builder()
            .header("Content-Type", &mime_type)
            .header("Content-Length", file_size)
            .header("Content-Disposition", &disposition)
            .header("Cache-Control", "private, no-cache")
            .body(body)
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;

        Ok(response)
    }
}
/// 獲取分享連結的元數據（不需要認證，用於前端顯示）
#[utoipa::path(
    get,
    path = "/api/share/{id}/info",
    params(
        ("id" = String, Path, description = "Share ID")
    ),
    responses(
        (status = 200, description = "Share link info", body = ShareInfoResponse),
        (status = 404, description = "Link not found"),
        (status = 410, description = "Link expired")
    )
)]
pub async fn get_share_info(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<ShareInfoResponse>, AppError> {
    // 查詢分享連結資訊
    let row: Option<ShareInfoRow> = sqlx::query_as(
        "SELECT file_path, password_hash, expires_at, created_at FROM share_links WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?;

    let (file_path_str, password_hash, expires_at, created_at) =
        row.ok_or(AppError::Status(StatusCode::NOT_FOUND))?;

    // 檢查是否過期
    if let Some(expiry) = expires_at {
        if Utc::now() > expiry {
            return Err(AppError::Status(StatusCode::GONE)); // 410 Gone for expired links
        }
    }

    // 獲取文件資訊
    let clean_path = file_path_str.strip_prefix('/').unwrap_or(&file_path_str);
    let full_path = state.storage_path.resolve(&file_path_str)?;

    if !full_path.exists() {
        tracing::warn!(
            "Share file not found: {:?} (from db path: {})",
            full_path,
            file_path_str
        );
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    let is_directory = full_path.is_dir();

    // 獲取文件名和大小
    let file_name = Path::new(clean_path)
        .file_name()
        .map_or_else(|| "unknown".to_string(), |s| s.to_string_lossy().to_string());

    let file_size = if is_directory {
        // Calculate total directory size by walking all files
        let full_path_for_size = full_path.clone();
        tokio::task::spawn_blocking(move || {
            let mut total: u64 = 0;
            for entry in WalkDir::new(&full_path_for_size)
                .follow_links(false)
                .into_iter()
                .flatten()
            {
                if entry.path().is_file() {
                    if let Ok(meta) = std::fs::metadata(entry.path()) {
                        total += meta.len();
                    }
                }
            }
            total
        })
        .await
        .unwrap_or(0)
    } else {
        tokio::fs::metadata(&full_path).await.map_or(0, |m| m.len())
    };

    // 猜測 MIME 類型
    let mime_type = if is_directory {
        None
    } else {
        mime_guess::from_path(&full_path).first().map(|m| m.to_string())
    };

    Ok(Json(ShareInfoResponse {
        id,
        file_name,
        file_size,
        mime_type,
        is_directory,
        is_password_protected: password_hash.is_some(),
        expires_at: expires_at.map(|t| t.to_rfc3339()),
        created_at: created_at.to_rfc3339(),
    }))
}
