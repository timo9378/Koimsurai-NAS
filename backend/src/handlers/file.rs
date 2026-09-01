use axum::{
    extract::{Extension, Multipart, Path as AxumPath, Request, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use tokio::fs;
use tokio::io::AsyncWriteExt;
// write! 寫進 String 需要這個 trait 在 scope（format_push_string 的建議寫法）
use crate::error::AppError;
use crate::models::FileInfo;
use crate::state::AppState;
use std::collections::{HashMap, HashSet};
use std::fmt::Write;
// use crate::utils::image::generate_thumbnails;
use std::path::Path;
use tower::util::ServiceExt; // for oneshot
use tower_http::services::ServeFile;
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema, specta::Type)]
pub struct CreateFolderRequest {
    /// 父目錄路徑，例如 "Documents"。空字串表示根目錄
    /// Parent directory path, e.g. "Documents". Empty string means root.
    pub path: String,
    /// 新資料夾名稱，例如 "New Folder"
    /// New folder name, e.g. "New Folder"
    pub folder_name: String,
}

#[utoipa::path(
    post,
    path = "/api/files/folder",
    request_body = CreateFolderRequest,
    responses(
        (status = 201, description = "資料夾建立成功 / Folder created"),
        (status = 403, description = "沒有寫入權限 / No write permission"),
        (status = 409, description = "資料夾已存在 / Folder already exists")
    )
)]
pub async fn create_folder(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateFolderRequest>,
) -> Result<StatusCode, AppError> {
    // 1. 組合路徑
    let parent_path = if payload.path.is_empty() || payload.path == "/" {
        String::new()
    } else {
        payload.path.trim_start_matches('/').to_string()
    };

    let full_relative_path = if parent_path.is_empty() {
        payload.folder_name.clone()
    } else {
        format!("{}/{}", parent_path, payload.folder_name)
    };

    // 2. 權限檢查 (檢查父目錄是否有寫入權限)
    let has_permission =
        sqlx::query_scalar::<_, bool>("SELECT can_write FROM permissions WHERE user_id = ? AND path = ?")
            .bind(user_id)
            .bind(&parent_path)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    if let Some(can_write) = has_permission {
        if !can_write {
            return Err(AppError::Status(StatusCode::FORBIDDEN));
        }
    }

    // 3. 驗證並建立實體路徑
    let target_path = state.storage_path.resolve(&full_relative_path)?;

    if target_path.exists() {
        return Err(AppError::Status(StatusCode::CONFLICT));
    }

    // 4. 建立資料夾
    fs::create_dir_all(&target_path).await.map_err(AppError::from)?;

    // 5. 寫入 Audit Log
    let () = state
        .audit
        .log(
            user_id,
            "create_folder",
            &full_relative_path,
            Some("Created new directory".to_string()),
            None,
        )
        .await;

    // ⚠️ 這裡**必須**同步寫進 files 表，不能只靠 file watcher。
    //
    // 原本的註解說「資料夾會由 file watcher 自動索引到資料庫」—— 那是真的，
    // 但那是**非同步**的。`list_files` 讀的是 files 表而不是檔案系統，
    // 於是建完資料夾之後前端立刻重新列目錄，很可能還看不到它：
    // 使用者按下「新增資料夾」，畫面上什麼也沒發生，過一下才冒出來。
    //
    // 上傳那條路徑一直都有寫（見 upload_file 的 INSERT INTO files），
    // 只有建資料夾漏了，兩者不一致。
    //
    // 這個 race 在 E2E 上表現成間歇性的紅：建完資料夾後等 15 秒仍然找不到
    // 桌面圖示。本機幾乎不會發生，CI runner 忙的時候就會。
    //
    // ON CONFLICT DO NOTHING：watcher 可能比這裡先跑到，那不是錯誤。
    let modified = chrono::Utc::now();
    let _ = sqlx::query(
        r"
        INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
        VALUES (?, ?, 0, NULL, ?, 1, ?)
        ON CONFLICT(path) DO NOTHING
        ",
    )
    .bind(&full_relative_path)
    .bind(&payload.folder_name)
    .bind(&parent_path)
    .bind(modified)
    .execute(&state.pool)
    .await;

    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
pub struct RenameRequest {
    pub new_path: String,
}

pub async fn rename_file(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath(path): AxumPath<String>,
    Json(payload): Json<RenameRequest>,
) -> Result<StatusCode, AppError> {
    // Check write permission
    let has_permission =
        sqlx::query_scalar::<_, bool>("SELECT can_write FROM permissions WHERE user_id = ? AND path = ?")
            .bind(user_id)
            .bind(&path)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    if let Some(can_write) = has_permission {
        if !can_write {
            return Err(AppError::Status(StatusCode::FORBIDDEN));
        }
    }

    let old_path = state.storage_path.resolve(&path)?;
    let new_path = state.storage_path.resolve(&payload.new_path)?;

    if !old_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    if new_path.exists() {
        return Err(AppError::Status(StatusCode::CONFLICT));
    }

    // Ensure parent directory of new path exists
    if let Some(parent) = new_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).await.map_err(AppError::from)?;
        }
    }

    fs::rename(old_path, new_path).await.map_err(AppError::from)?;

    // 更新資料庫中的路徑（files、file_tags、file_stars、permissions、share_links、AI tables）
    // 使用 Transaction 確保原子性：所有更新要麼全成功，要麼全回滾
    // Normalize paths stored in DB (no leading slash)
    let normalized_old = path.replace('\\', "/").trim_start_matches('/').to_string();
    let normalized_new = payload
        .new_path
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();

    // 開始事務
    let mut tx = state.pool.begin().await.map_err(AppError::from)?;

    // 查出所有受影響的 files 路徑（包含目標本身與子路徑）
    let like_pattern = format!("{normalized_old}/%");
    let affected_paths: Vec<String> =
        sqlx::query_scalar("SELECT path FROM files WHERE path = ? OR path LIKE ?")
            .bind(&normalized_old)
            .bind(&like_pattern)
            .fetch_all(&mut *tx)
            .await
            .map_err(AppError::from)?;

    for old_db_path in affected_paths {
        let new_db_path = old_db_path.replacen(&normalized_old, &normalized_new, 1);
        let new_parent = std::path::Path::new(&new_db_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
            .unwrap_or_default();
        let new_name = std::path::Path::new(&new_db_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // 更新 files
        sqlx::query("UPDATE files SET path = ?, parent_path = ?, name = ? WHERE path = ?")
            .bind(&new_db_path)
            .bind(&new_parent)
            .bind(&new_name)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;

        // 更新 file_tags
        sqlx::query("UPDATE file_tags SET file_path = ? WHERE file_path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;

        // 更新 file_stars
        sqlx::query("UPDATE file_stars SET file_path = ? WHERE file_path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;

        // 更新 permissions
        sqlx::query("UPDATE permissions SET path = ? WHERE path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;

        // 更新 share_links
        sqlx::query("UPDATE share_links SET file_path = ? WHERE file_path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;

        // 更新 AI 相關表格
        sqlx::query("UPDATE image_ai_tags SET file_path = ? WHERE file_path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;
        sqlx::query("UPDATE ai_analysis_status SET file_path = ? WHERE file_path = ?")
            .bind(&new_db_path)
            .bind(&old_db_path)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;
    }

    // 提交事務：所有更新成功才會寫入
    tx.commit().await.map_err(AppError::from)?;

    // Audit Log
    let () = state
        .audit
        .log(
            user_id,
            "rename_file",
            &path,
            Some(format!("Renamed to {}", payload.new_path)),
            None,
        )
        .await;

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
pub struct ListFilesQuery {
    pub sort_by: Option<String>, // name, size, modified
    pub order: Option<String>,   // asc, desc
    pub search: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/api/files/{path}",
    params(
        ("path" = String, Path, description = "Directory path"),
        ("sort_by" = Option<String>, Query, description = "Sort by field"),
        ("order" = Option<String>, Query, description = "Sort order"),
        ("search" = Option<String>, Query, description = "Search query"),
        ("page" = Option<i64>, Query, description = "Page number"),
        ("limit" = Option<i64>, Query, description = "Items per page")
    ),
    responses(
        (status = 200, description = "List files in directory", body = Vec<FileInfo>)
    )
)]
pub async fn list_files(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath(path): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<ListFilesQuery>,
) -> Result<Json<Vec<FileInfo>>, AppError> {
    // Check permissions
    let has_permission =
        sqlx::query_scalar::<_, bool>("SELECT can_read FROM permissions WHERE user_id = ? AND path = ?")
            .bind(user_id)
            .bind(&path)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    if let Some(can_read) = has_permission {
        if !can_read {
            return Err(AppError::Status(StatusCode::FORBIDDEN));
        }
    }

    // Normalize path for DB query (remove trailing slash if any, ensure forward slashes)
    let normalized_path = path.trim_end_matches('/').replace('\\', "/");
    let parent_path = if normalized_path.is_empty() {
        String::new()
    } else {
        normalized_path
    };

    let mut sql =
        String::from("SELECT name, is_dir, size, modified, mime_type, parent_path FROM files WHERE ");
    let mut params = Vec::new();

    let is_search = query.search.is_some();

    if let Some(search) = &query.search {
        // Search within current directory and its subdirectories
        if parent_path.is_empty() {
            // Root directory: search all files
            sql.push_str("name LIKE ?");
            params.push(format!("%{search}%"));
        } else {
            // Specific directory: search within this directory tree
            sql.push_str("(parent_path = ? OR parent_path LIKE ?) AND name LIKE ?");
            params.push(parent_path.clone());
            params.push(format!("{parent_path}/%"));
            params.push(format!("%{search}%"));
        }
    } else {
        sql.push_str("parent_path = ?");
        params.push(parent_path.clone());
    }

    // Sorting
    let sort_column = match query.sort_by.as_deref() {
        Some("size") => "size",
        Some("modified" | "date") => "modified",
        _ => "name", // Default sort by name
    };

    let order = match query.order.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    // ⚠️ 依名稱排序時要 `COLLATE NOCASE`。
    //
    // SQLite 預設的 BINARY 定序是**逐位元組**比較，於是大寫全部排在小寫前面：
    //
    //     ABC, Banana, Zebra, abc, apple, cherry
    //
    // `ABC` 跟 `abc` 中間隔著整個字母表 —— 沒有任何檔案管理器是這樣排的，
    // 而這是使用者在一般檢視裡看到的順序。
    //
    // ⚠️ 排序一定要在 SQL 裡做，不能撈出來再由前端排：分頁是伺服器端的
    // （LIMIT/OFFSET），前端只拿得到一頁，對一頁排序等於排錯。
    //
    // NOCASE 只折疊 ASCII 大小寫，CJK 仍然是碼位順序 —— 要真正的語言感知
    // 定序得引入 ICU，那是另一回事。這裡先把最明顯的錯處理掉。
    let name_collation = if sort_column == "name" {
        " COLLATE NOCASE"
    } else {
        ""
    };
    let _ = write!(
        sql,
        " ORDER BY is_dir DESC, {sort_column}{name_collation} {order}"
    );

    // Pagination
    // ⚠️ limit 由查詢字串控制，原本沒有上限 —— 客戶端送 limit=100000 就能讓單一
    // 請求撈爆整張表。夾在 1..=500，同時也讓下面的 IN 子句參數量有界。
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    // ⚠️ page 與 limit 都由查詢字串控制，兩者都必須夾範圍。
    //
    // 原本寫成 `(page - 1) * limit`：
    //   - page = i64::MIN 時，`- 1` 就先 underflow（`.max(0)` 來不及救，
    //     它在減法**之後**才執行）
    //   - page 很大時 `* limit` overflow
    // debug build 會 panic（連線直接斷），release 預設是 wrapping ——
    // 那更糟：不會有任何症狀，只是算出一個荒謬的 offset。
    // schemathesis 對 /api/audit/logs 與 /api/files 各撞出這兩種。
    let offset = query
        .page
        .unwrap_or(1)
        .clamp(1, i64::from(u32::MAX))
        .saturating_sub(1)
        * limit;

    sql.push_str(" LIMIT ? OFFSET ?");

    let mut query_builder = sqlx::query_as::<
        _,
        (
            String,
            bool,
            i64,
            chrono::NaiveDateTime,
            Option<String>,
            Option<String>,
        ),
    >(&sql);

    for param in params {
        query_builder = query_builder.bind(param);
    }
    query_builder = query_builder.bind(limit).bind(offset);

    let rows = query_builder
        .fetch_all(&state.pool)
        .await
        .map_err(AppError::from)?;

    let mut files = Vec::new();
    let mut stale_paths: Vec<String> = Vec::new();

    for (name, is_dir, size, modified, mime_type, row_parent_path) in rows {
        // For search results, use the actual parent_path from DB; otherwise use the requested parent_path
        let effective_parent = if is_search {
            row_parent_path.as_deref().unwrap_or("").to_string()
        } else {
            parent_path.clone()
        };

        // 驗證檔案是否真的存在
        // Verify the file actually exists on disk
        // DB 裡的路徑也要走 resolve —— 索引器寫進去的東西不該被當成可信輸入，
        // 而且這裡的 `is_search` 分支讀的是**別的列**的 parent_path。
        let Ok(file_path) = state.storage_path.resolve(&if effective_parent.is_empty() {
            name.clone()
        } else {
            format!("{effective_parent}/{name}")
        }) else {
            continue;
        };
        if !file_path.exists() {
            // 記錄不存在的檔案，稍後清理
            let db_path = if effective_parent.is_empty() {
                name.clone()
            } else {
                format!("{effective_parent}/{name}")
            };
            stale_paths.push(db_path);
            continue; // 跳過這個檔案
        }

        let metadata = if is_dir {
            crate::utils::metadata::FileMetadata::None
        } else if let Some(ref mime) = mime_type {
            crate::utils::metadata::extract_metadata(&file_path, mime)
        } else {
            crate::utils::metadata::FileMetadata::None
        };

        // Query tags
        let file_db_path = if effective_parent.is_empty() {
            name.clone()
        } else {
            format!("{effective_parent}/{name}")
        };

        files.push(FileInfo {
            name,
            path: file_db_path,
            is_dir,
            size: u64::try_from(size).unwrap_or(0),
            modified: modified.and_utc().timestamp().to_string(),
            mime_type,
            metadata: Some(metadata),
            // 先留空，下面一次撈完再填 —— 見該段說明
            tags: Vec::new(),
            is_starred: false,
        });
    }

    // ── tags 與 stars：一次撈完，不要在迴圈裡逐檔查 ─────────────────────────
    // 原本這兩個查詢在上面的迴圈內，也就是每個檔案各打兩次 DB：列一個含 N 個項目的
    // 目錄要 1 + 2N 次 SQLite 查詢（1000 個檔 = 2001 次），而這是整個 NAS 最常走的
    // 端點。判準很清楚：這些資料「一次查得完」，所以是 N+1 而不是 streaming。
    // limit 已夾在 500，IN 的參數量有界（SQLite 預設上限 999）。
    if !files.is_empty() {
        let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
        let placeholders = vec!["?"; paths.len()].join(",");

        let tag_sql = format!(
            "SELECT file_path, tag_name, color FROM file_tags WHERE user_id = ? AND file_path IN ({placeholders})"
        );
        let mut tag_q = sqlx::query_as::<_, (String, String, Option<String>)>(&tag_sql).bind(user_id);
        for path in &paths {
            tag_q = tag_q.bind(path);
        }
        let mut tags_by_path: HashMap<String, Vec<crate::models::Tag>> = HashMap::new();
        for (file_path, name, color) in tag_q.fetch_all(&state.pool).await.map_err(AppError::from)? {
            tags_by_path
                .entry(file_path)
                .or_default()
                .push(crate::models::Tag { name, color });
        }

        let star_sql =
            format!("SELECT file_path FROM file_stars WHERE user_id = ? AND file_path IN ({placeholders})");
        let mut star_q = sqlx::query_scalar::<_, String>(&star_sql).bind(user_id);
        for path in &paths {
            star_q = star_q.bind(path);
        }
        let starred: HashSet<String> = star_q
            .fetch_all(&state.pool)
            .await
            .map_err(AppError::from)?
            .into_iter()
            .collect();

        for file in &mut files {
            if let Some(tags) = tags_by_path.remove(&file.path) {
                file.tags = tags;
            }
            file.is_starred = starred.contains(&file.path);
        }
    }

    // 異步清理不存在的檔案記錄（不阻塞回應）
    // Async cleanup of stale file records (non-blocking)
    if !stale_paths.is_empty() {
        let pool = state.pool.clone();
        tokio::spawn(async move {
            for path in stale_paths {
                if let Err(e) = sqlx::query("DELETE FROM files WHERE path = ?")
                    .bind(&path)
                    .execute(&pool)
                    .await
                {
                    tracing::error!("Failed to cleanup stale file {}: {}", path, e);
                } else {
                    tracing::debug!("Cleaned up stale file record: {}", path);
                }
            }
        });
    }

    Ok(Json(files))
}

// 用於根目錄列表
// For root directory listing
#[utoipa::path(
    get,
    path = "/api/files",
    params(
        ("sort_by" = Option<String>, Query, description = "Sort by field"),
        ("order" = Option<String>, Query, description = "Sort order"),
        ("search" = Option<String>, Query, description = "Search query"),
        ("page" = Option<i64>, Query, description = "Page number"),
        ("limit" = Option<i64>, Query, description = "Items per page")
    ),
    responses(
        (status = 200, description = "List files in root", body = Vec<FileInfo>)
    )
)]
pub async fn list_files_root(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    query: axum::extract::Query<ListFilesQuery>,
) -> Result<Json<Vec<FileInfo>>, AppError> {
    list_files(State(state), Extension(user_id), AxumPath(String::new()), query).await
}

#[utoipa::path(
    get,
    path = "/api/download/{path}",
    params(
        ("path" = String, Path, description = "File path")
    ),
    responses(
        (status = 200, description = "Download file")
    )
)]
pub async fn download_file(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
    req: Request,
) -> Result<impl IntoResponse, AppError> {
    let full_path = state.storage_path.resolve(&path)?;

    if !full_path.exists() || !full_path.is_file() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    // ServeFile 自動處理 Range header，支援影片串流
    // ServeFile automatically handles Range header, supporting video streaming
    let service = ServeFile::new(full_path);
    let result = service.oneshot(req).await;

    match result {
        Ok(response) => Ok(response.into_response()),
        Err(_) => Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR)),
    }
}

#[utoipa::path(
    post,
    path = "/api/upload/{path}",
    params(
        ("path" = String, Path, description = "Target directory")
    ),
    request_body(content = String, description = "Multipart form data", content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "File uploaded")
    )
)]
pub async fn upload_file(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
    mut multipart: Multipart,
) -> Result<StatusCode, AppError> {
    tracing::info!("upload_file called with path: {:?}", path);

    let target_dir = state.storage_path.resolve(&path)?;
    tracing::info!("Target directory: {:?}", target_dir);

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).await.map_err(AppError::from)?;
    }

    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Failed to get next multipart field: {:?}", e);
        AppError::Status(StatusCode::BAD_REQUEST)
    })? {
        let file_name = field
            .file_name()
            .ok_or(AppError::Status(StatusCode::BAD_REQUEST))?
            .to_string();

        // 防止檔名中的 Path Traversal
        // Prevent Path Traversal in filename
        if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
            continue;
        }

        // ⚠️ 空檔名要擋掉。`target_dir.join("")` 會等於 `target_dir` **本身**，
        // 接著 `File::create` 對著一個目錄執行 → EISDIR，而原本的處置是把
        // io::Error 往上丟，客戶端拿到
        // `500 {"error":"Is a directory (os error 21)"}`：狀態碼是錯的
        // （這是客戶端送的東西造成的），而且把 OS 的錯誤字串原封不動送出去。
        // multipart 的 `filename=""` 是合法的編碼，所以這條真的到得了。
        // （schemathesis 找到的。）
        if file_name.is_empty() {
            return Err(AppError::Status(StatusCode::BAD_REQUEST));
        }

        let file_path = target_dir.join(&file_name);

        // ⚠️ 目標已經是一個**目錄**的話，下面的 `File::create` 會失敗，
        // 而原本的處置是把 io::Error 往上丟 —— 客戶端拿到的是
        // `500 {"error":"Is a directory (os error 21)"}`：
        //   - 500 是錯的，這是客戶端送的東西造成的
        //   - 而且把 OS 的錯誤字串原封不動送出去
        // 回 409，跟 upload/init 對「檔案已存在」的處置一致。
        // （schemathesis 找到的。）
        if file_path.is_dir() {
            return Err(AppError::Status(StatusCode::CONFLICT));
        }

        tracing::info!("Processing file: {} -> {:?}", file_name, file_path);

        // 串流寫入檔案，避免佔用過多記憶體
        // Stream write to file to avoid excessive memory usage
        // Versioning: if file exists, move it to versions
        if file_path.exists() {
            if let Err(e) =
                crate::utils::versioning::create_version(&file_path, state.storage_path.as_path()).await
            {
                tracing::error!("Failed to create version for {:?}: {:?}", file_path, e);
            }
        }

        let mut file = fs::File::create(&file_path).await.map_err(AppError::from)?;

        let mut total_written: usize = 0;
        while let Some(chunk) = field.chunk().await.map_err(|e| {
            tracing::error!("Failed to read chunk: {:?}", e);
            AppError::Status(StatusCode::BAD_REQUEST)
        })? {
            file.write_all(&chunk).await.map_err(AppError::from)?;
            total_written += chunk.len();
        }

        // ⚠️ 一定要 flush，不能靠 drop。
        //
        // `tokio::fs::File` 有自己的緩衝，而它的文件明講：drop 時**不保證**
        // 資料已經寫出去，而且 drop 過程中發生的寫入錯誤會被**直接吞掉**。
        // 少了這行有兩個後果：
        //   1. 回應送出時檔案可能還沒完整落地 —— 客戶端上傳完立刻列目錄／下載
        //      會拿到截斷或不存在的檔案（測試在機器忙碌時偶發紅過一次，
        //      就是這個）
        //   2. 磁碟滿了之類的錯誤完全看不到，上傳回報成功而檔案是壞的
        //
        // 用 flush 而不是 sync_all：前者把緩衝推給 OS，之後任何讀取都看得到
        // 正確內容，也拿得到錯誤；後者還要 fsync 到實體磁碟（防斷電），
        // 對 10GB 級的上傳代價太大，那是另一個層次的取捨。
        file.flush().await.map_err(AppError::from)?;
        tracing::info!("File {} written successfully, {} bytes", file_name, total_written);

        // NOTE: thumbnail generation will be enqueued after we determine mime_type

        // ====== 將檔案寫入 files 資料表，並 enqueue 索引（與 upload_chunk 的行為一致） ======
        let full_relative_path = if path.is_empty() {
            file_name.clone()
        } else {
            format!("{}/{}", path.trim_start_matches('/'), file_name)
        };
        let full_relative_path = full_relative_path.replace('\\', "/");

        if let Ok(metadata) = tokio::fs::metadata(&file_path).await {
            if let Ok(modified_time) = metadata.modified() {
                let modified = chrono::DateTime::<chrono::Utc>::from(modified_time).naive_utc();
                let mime_type = mime_guess::from_path(&file_path)
                    .first_or_octet_stream()
                    .to_string();
                let parent_path = std::path::Path::new(&full_relative_path)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
                    .unwrap_or_default();

                // Insert or update files table
                if let Err(e) = sqlx::query(
                    r"
                    INSERT INTO files (path, name, size, mime_type, parent_path, is_dir, modified)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        size = excluded.size,
                        modified = excluded.modified,
                        mime_type = excluded.mime_type
                    ",
                )
                .bind(&full_relative_path)
                .bind(&file_name)
                .bind(i64::try_from(metadata.len()).unwrap_or(i64::MAX))
                .bind(&mime_type)
                .bind(&parent_path)
                .bind(false)
                .bind(modified)
                .execute(&state.pool)
                .await
                {
                    tracing::error!(
                        "Failed to insert/update files table for {}: {:?}",
                        full_relative_path,
                        e
                    );
                } else {
                    // Enqueue index job
                    let index_job = crate::utils::queue::JobType::IndexFile {
                        path: full_relative_path.clone(),
                    };
                    if let Err(e) = state.queue.enqueue(index_job).await {
                        tracing::error!("Failed to enqueue index job for {}: {}", full_relative_path, e);
                    }

                    // Enqueue thumbnail generation only for detected images/videos
                    if mime_type.starts_with("image/")
                        || mime_type.starts_with("video/")
                        || crate::utils::image::is_likely_media(&file_path)
                    {
                        let thumb_job = crate::utils::queue::JobType::GenerateThumbnail {
                            input_path: file_path.clone(),
                            output_path: file_path.clone(),
                        };
                        if let Err(e) = state.queue.enqueue(thumb_job).await {
                            tracing::error!(
                                "Failed to enqueue thumbnail job for {}: {}",
                                full_relative_path,
                                e
                            );
                        }
                    }
                }
            }
        }
        // ======================================================================
    }

    Ok(StatusCode::CREATED)
}

// 用於根目錄上傳
// For root directory upload
#[utoipa::path(
    post,
    path = "/api/upload",
    request_body(content = String, description = "Multipart form data", content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "File uploaded")
    )
)]
pub async fn upload_file_root(
    State(state): State<AppState>,
    multipart: Multipart,
) -> Result<StatusCode, AppError> {
    upload_file(State(state), AxumPath(String::new()), multipart).await
}

#[utoipa::path(
    get,
    path = "/api/thumbnail/{size}/{path}",
    params(
        ("size" = String, Path, description = "Thumbnail size (small, medium, large)"),
        ("path" = String, Path, description = "File path")
    ),
    responses(
        (status = 200, description = "Download thumbnail")
    )
)]
pub async fn get_thumbnail(
    State(state): State<AppState>,
    AxumPath((size, path)): AxumPath<(String, String)>,
    req: Request,
) -> Result<impl IntoResponse, AppError> {
    // Validate path first
    let full_path = state.storage_path.resolve(&path)?;

    // ⚠️ 要 `is_file` 而不是 `exists`。
    //
    // 目錄也是「存在」的，而下面會把它交給 `ServeFile` —— 那會宣告 chunked
    // encoding 然後送不出任何 chunk，客戶端拿到的是「連線中斷」而不是一個
    // 乾淨的 404（schemathesis 對 /api/thumbnail/0/0 撞到的就是這個）。
    if !full_path.is_file() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    // Construct thumbnail path
    // storage/.thumbnails/path/to/file.jpg.small.jpg

    let relative_path = full_path
        .strip_prefix(state.storage_path.as_path())
        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
    let thumb_root = state.storage_path.internal(".thumbnails");
    let thumb_dir = thumb_root.join(relative_path.parent().unwrap_or_else(|| Path::new("")));
    let file_name = full_path.file_name().unwrap_or_default().to_string_lossy();

    let thumb_name = format!("{file_name}.{size}.jpg");
    let thumb_path = thumb_dir.join(thumb_name);

    if !thumb_path.exists() {
        // Thumbnail doesn't exist - enqueue generation job and serve original file
        // This ensures the thumbnail will be available on future requests
        let thumb_job = crate::utils::queue::JobType::GenerateThumbnail {
            input_path: full_path.clone(),
            output_path: thumb_path.clone(),
        };
        if let Err(e) = state.queue.enqueue(thumb_job).await {
            tracing::warn!("Failed to enqueue thumbnail job for {:?}: {}", full_path, e);
        }

        // Serve original file instead of returning 404
        let service = ServeFile::new(&full_path);
        let result = service.oneshot(req).await;

        return match result {
            Ok(response) => Ok(response.into_response()),
            Err(_) => Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR)),
        };
    }

    let service = ServeFile::new(thumb_path);
    let result = service.oneshot(req).await;

    match result {
        Ok(response) => Ok(response.into_response()),
        Err(_) => Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR)),
    }
}

/// 將檔案移動到垃圾桶的共用邏輯
/// Shared utility: move a file/directory to the .trash folder and record metadata
pub async fn move_to_trash(
    storage_path: &crate::storage::StorageRoot,
    pool: &sqlx::Pool<sqlx::Sqlite>,
    file_path: &str,
    user_id: i64,
) -> Result<String, AppError> {
    let full_path = storage_path.resolve(file_path)?;

    if !full_path.exists() {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }

    let trash_root = storage_path.internal(".trash");
    if !trash_root.exists() {
        fs::create_dir_all(&trash_root).await.map_err(AppError::from)?;
    }

    // Flatten trash structure: move directly to trash root
    let file_name = full_path.file_name().unwrap_or_default().to_string_lossy();
    let trash_path = trash_root.join(file_name.as_ref());

    // Handle collision by appending timestamp
    let (final_trash_path, trash_name) = if trash_path.exists() {
        let timestamp = chrono::Utc::now().timestamp();
        let new_name = format!("{file_name}.{timestamp}");
        (trash_root.join(&new_name), new_name)
    } else {
        (trash_path, file_name.to_string())
    };

    fs::rename(&full_path, &final_trash_path)
        .await
        .map_err(AppError::from)?;

    // Record original path in trash_metadata for correct restore
    let normalized_path = file_path.replace('\\', "/");
    let _ = sqlx::query(
        "INSERT OR REPLACE INTO trash_metadata (trash_name, original_path, deleted_by) VALUES (?, ?, ?)",
    )
    .bind(&trash_name)
    .bind(&normalized_path)
    .bind(user_id)
    .execute(pool)
    .await;

    // 從 files 資料表移除記錄
    // Remove from files table (including children if it's a directory)
    sqlx::query("DELETE FROM files WHERE path = ? OR path LIKE ?")
        .bind(&normalized_path)
        .bind(format!("{normalized_path}/%"))
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(trash_name)
}

#[utoipa::path(
    delete,
    path = "/api/files/{path}",
    params(
        ("path" = String, Path, description = "File path")
    ),
    responses(
        (status = 200, description = "File moved to trash")
    )
)]
pub async fn delete_file(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    AxumPath(path): AxumPath<String>,
) -> Result<StatusCode, AppError> {
    // Check write permission
    let has_permission =
        sqlx::query_scalar::<_, bool>("SELECT can_write FROM permissions WHERE user_id = ? AND path = ?")
            .bind(user_id)
            .bind(&path)
            .fetch_optional(&state.pool)
            .await
            .map_err(AppError::from)?;

    if let Some(can_write) = has_permission {
        if !can_write {
            return Err(AppError::Status(StatusCode::FORBIDDEN));
        }
    }

    move_to_trash(&state.storage_path, &state.pool, &path, user_id).await?;

    // Audit Log
    let () = state
        .audit
        .log(
            user_id,
            "delete_file",
            &path,
            Some("Moved to trash".to_string()),
            None,
        )
        .await;

    Ok(StatusCode::OK)
}

#[derive(Deserialize, ToSchema, specta::Type)]
pub struct BatchOperationRequest {
    pub paths: Vec<String>,
    pub destination: Option<String>, // For move/copy
}

#[utoipa::path(
    post,
    path = "/api/files/batch/delete",
    request_body = BatchOperationRequest,
    responses(
        (status = 200, description = "Batch delete initiated")
    )
)]
pub async fn batch_delete(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<BatchOperationRequest>,
) -> Result<StatusCode, AppError> {
    for path in payload.paths {
        if let Err(e) = move_to_trash(&state.storage_path, &state.pool, &path, user_id).await {
            // 記錄後繼續處理其餘檔案，不整批中止
            tracing::error!("Failed to move '{}' to trash: {:?}", path, e);
        }
    }

    Ok(StatusCode::OK)
}

#[utoipa::path(
    post,
    path = "/api/files/batch/move",
    request_body = BatchOperationRequest,
    responses(
        (status = 200, description = "Batch move initiated")
    )
)]
pub async fn batch_move(
    State(state): State<AppState>,
    Json(payload): Json<BatchOperationRequest>,
) -> Result<StatusCode, AppError> {
    let destination = payload
        .destination
        .ok_or(AppError::Status(StatusCode::BAD_REQUEST))?;
    let dest_path = state.storage_path.resolve(&destination)?;

    if !dest_path.exists() {
        fs::create_dir_all(&dest_path).await.map_err(AppError::from)?;
    }

    for path in payload.paths {
        let src_path = state.storage_path.resolve(&path)?;
        if !src_path.exists() {
            continue;
        }

        let file_name = src_path
            .file_name()
            .ok_or(AppError::Status(StatusCode::BAD_REQUEST))?;
        let target_path = dest_path.join(file_name);

        if let Err(e) = fs::rename(src_path, target_path).await {
            tracing::error!("Failed to move file: {}", e);
        }
    }

    Ok(StatusCode::OK)
}

#[utoipa::path(
    post,
    path = "/api/files/batch/copy",
    request_body = BatchOperationRequest,
    responses(
        // ⚠️ 實際回 202（非同步進行中），不是 200。schemathesis 抓到的。
        (status = 202, description = "Batch copy initiated")
    )
)]
pub async fn batch_copy(
    State(state): State<AppState>,
    Json(payload): Json<BatchOperationRequest>,
) -> Result<StatusCode, AppError> {
    let destination = payload
        .destination
        .ok_or(AppError::Status(StatusCode::BAD_REQUEST))?;

    // ⚠️ 這裡的驗證不能省。worker 拿不到 StorageRoot（它自己從環境變數重建
    // 根路徑），所以型別層的保護到 enqueue 就結束了 —— 邊界在這一行。
    // 緊接在上面的 batch_move 一直都有驗，batch_copy 沒有。
    state.storage_path.resolve(&destination)?;
    for path in &payload.paths {
        state.storage_path.resolve(path)?;
    }

    // Enqueue copy job
    let job_type = crate::utils::queue::JobType::CopyFiles {
        paths: payload.paths,
        destination,
    };

    state.queue.enqueue(job_type).await.map_err(|e| {
        tracing::error!("Failed to enqueue copy job: {}", e);
        AppError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    Ok(StatusCode::ACCEPTED)
}

/// 我的最愛檔案資訊（包含 `starred_at` 時間戳）
/// Favorite file info with `starred_at` timestamp
#[derive(serde::Serialize, ToSchema, specta::Type)]
pub struct FavoriteFileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[specta(type = specta_typescript::Number)]
    pub size: u64,
    pub modified: String,
    pub mime_type: Option<String>,
    pub starred_at: String,
}

#[utoipa::path(
    get,
    path = "/api/favorites",
    responses(
        (status = 200, description = "取得我的最愛檔案列表 / Get favorites list", body = Vec<FavoriteFileInfo>)
    )
)]
pub async fn list_favorites(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<FavoriteFileInfo>>, AppError> {
    // Join file_stars with files to get metadata
    // 聯結 file_stars 與 files 資料表取得完整資訊
    let rows = sqlx::query_as::<
        _,
        (
            String,
            String,
            bool,
            i64,
            chrono::NaiveDateTime,
            Option<String>,
            chrono::NaiveDateTime,
        ),
    >(
        r"
        SELECT 
            f.name,
            f.path,
            f.is_dir,
            f.size,
            f.modified,
            f.mime_type,
            s.created_at as starred_at
        FROM files f
        JOIN file_stars s ON f.path = s.file_path
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
        ",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(AppError::from)?;

    let favorites: Vec<FavoriteFileInfo> = rows
        .into_iter()
        .map(
            |(name, path, is_dir, size, modified, mime_type, starred_at)| FavoriteFileInfo {
                name,
                path,
                is_dir,
                size: u64::try_from(size).unwrap_or(0),
                modified: modified.and_utc().timestamp().to_string(),
                mime_type,
                starred_at: starred_at.and_utc().timestamp().to_string(),
            },
        )
        .collect();

    Ok(Json(favorites))
}
