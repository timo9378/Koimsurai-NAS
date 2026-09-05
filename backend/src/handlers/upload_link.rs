use crate::error::AppError;
use crate::models::{CreateUploadLinkRequest, UploadLinkInfoResponse, UploadLinkResponse};
use crate::state::AppState;
use crate::utils::hash::{hash_password_async, verify_password_async};
use axum::{
    extract::{Extension, Multipart, Path as AxumPath, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

/// `SELECT target_path, password_hash, expires_at, max_files, max_file_size, uploaded_count, created_at`
type UploadLinkInfoRow = (
    String,
    Option<String>,
    Option<chrono::DateTime<Utc>>,
    Option<i32>,
    Option<i64>,
    i32,
    chrono::DateTime<Utc>,
);
/// 同上但不取 `created_at`
type UploadLinkRow = (
    String,
    Option<String>,
    Option<chrono::DateTime<Utc>>,
    Option<i32>,
    Option<i64>,
    i32,
);

use chrono::{Duration, Utc};
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct UploadQuery {
    pub pwd: Option<String>,
}

/// 建立上傳連結
#[utoipa::path(
    post,
    path = "/api/upload-link",
    request_body = CreateUploadLinkRequest,
    responses(
        // ⚠️ 實際回的是 200 不是 201 —— handler 回 `Json<T>`，axum 的預設狀態碼
        // 是 200。`create_share_link` 早就修過同一個錯，這條當時還不在
        // `paths(...)` 裡（見 openapi_drift_tests 的第三種漂移），所以
        // schemathesis 從來沒打到它。把 25 個 handler 補進 spec 之後第一次
        // fuzz 就抓出來了。
        (status = 200, description = "Upload link created", body = UploadLinkResponse)
    )
)]
pub async fn create_upload_link(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateUploadLinkRequest>,
) -> Result<Json<UploadLinkResponse>, AppError> {
    // 見 create_share_link 的說明；這條的 sink 更糟 —— 是「寫」而不是「讀」。
    state.storage_path.resolve(&payload.target_path)?;

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
        "INSERT INTO upload_links (id, target_path, password_hash, expires_at, max_files, max_file_size, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&payload.target_path)
    .bind(password_hash)
    .bind(expires_at)
    .bind(payload.max_files)
    .bind(payload.max_file_size)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(UploadLinkResponse {
        id: id.clone(),
        url: format!("/u/{id}"),
        expires_at: expires_at.map(|t| t.to_rfc3339()),
    }))
}

/// 獲取上傳連結的元數據
#[utoipa::path(
    get,
    path = "/api/upload-link/{id}/info",
    params(
        ("id" = String, Path, description = "Upload Link ID")
    ),
    responses(
        (status = 200, description = "Upload link info", body = UploadLinkInfoResponse),
        (status = 404, description = "Link not found"),
        (status = 410, description = "Link expired")
    )
)]
pub async fn get_upload_link_info(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<UploadLinkInfoResponse>, AppError> {
    let row: Option<UploadLinkInfoRow> = sqlx::query_as(
        "SELECT target_path, password_hash, expires_at, max_files, max_file_size, uploaded_count, created_at FROM upload_links WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?;

    let (target_path, password_hash, expires_at, max_files, max_file_size, uploaded_count, created_at) =
        row.ok_or(AppError::Status(StatusCode::NOT_FOUND))?;

    // 檢查是否過期（`>` vs `>=` 是等價變異，見 share.rs 的說明）
    if let Some(expiry) = expires_at {
        if Utc::now() > expiry {
            return Err(AppError::Status(StatusCode::GONE));
        }
    }

    // 獲取目標資料夾名稱
    let target_folder = Path::new(&target_path).file_name().map_or_else(
        || {
            if target_path == "/" || target_path.is_empty() {
                "Root".to_string()
            } else {
                target_path.clone()
            }
        },
        |s| s.to_string_lossy().to_string(),
    );

    Ok(Json(UploadLinkInfoResponse {
        id,
        target_folder,
        is_password_protected: password_hash.is_some(),
        expires_at: expires_at.map(|t| t.to_rfc3339()),
        max_files,
        max_file_size,
        uploaded_count,
        created_at: created_at.to_rfc3339(),
    }))
}

/// 透過上傳連結上傳檔案
#[utoipa::path(
    post,
    // ⚠️ `/u/{id}` 是**前端頁面**的路由，不是這個端點。寫錯的後果是
    // schemathesis 一直在 fuzz 一條不存在的路徑（打到 SPA fallback 回 200
    // HTML），而真正的上傳端點 —— **不需要登入、收 multipart、會寫檔** ——
    // 從來沒有被 fuzz 過。今天在它身上找到的兩個洞（數量限制可繞過、
    // 失敗留下殘缺檔案）都是人工看出來的。
    path = "/api/upload-link/{id}/upload",
    params(
        ("id" = String, Path, description = "Upload Link ID"),
        UploadQuery
    ),
    responses(
        (status = 200, description = "File uploaded successfully"),
        (status = 401, description = "Password required or invalid"),
        (status = 404, description = "Link not found or expired"),
        (status = 413, description = "File too large"),
        (status = 429, description = "Upload limit reached")
    )
)]
pub async fn upload_via_link(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    // 查詢上傳連結資訊
    let row: Option<UploadLinkRow> = sqlx::query_as(
        "SELECT target_path, password_hash, expires_at, max_files, max_file_size, uploaded_count FROM upload_links WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(AppError::from)?;

    let (target_path, password_hash, expires_at, max_files, max_file_size, uploaded_count) =
        row.ok_or(AppError::Status(StatusCode::NOT_FOUND))?;

    // 檢查是否過期（`>` vs `>=` 是等價變異，見 share.rs 的說明）
    if let Some(expiry) = expires_at {
        if Utc::now() > expiry {
            return Err(AppError::Status(StatusCode::GONE));
        }
    }

    // 檢查密碼
    if let Some(ref hash) = password_hash {
        // ⚠️ 額度檢查要在 argon2 **之前** —— 擋在後面的話被擋掉的請求仍然付了
        // 19 MiB + CPU 的代價。跟分享連結同一個限制器，見 `utils/throttle.rs`。
        if !state.link_attempts.allows(&id) {
            return Err(AppError::Status(StatusCode::TOO_MANY_REQUESTS));
        }

        let Some(pwd) = query.pwd.clone() else {
            return Err(AppError::Status(StatusCode::UNAUTHORIZED));
        };
        if !verify_password_async(pwd, hash.clone())
            .await
            .map_err(AppError::from)?
        {
            state.link_attempts.record_failure(&id);
            return Err(AppError::Status(StatusCode::UNAUTHORIZED));
        }
        state.link_attempts.reset(&id);
    }

    // 早退：一開始就滿了的話連 multipart 都不用讀。真正的把關在迴圈裡，
    // 因為一個請求可以帶很多個檔案（見下面的「預約」）。
    if let Some(max) = max_files {
        if uploaded_count >= max {
            return Err(AppError::Status(StatusCode::TOO_MANY_REQUESTS));
        }
    }

    let mut files_uploaded = 0;
    let mut pending_relative_path: Option<String> = None;

    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Multipart field error: {:?}", e);
        AppError::Status(StatusCode::BAD_REQUEST)
    })? {
        let field_name = field.name().unwrap_or("").to_string();

        // Handle relative_path text field (sent before each file for folder uploads)
        if field_name == "relative_path" {
            pending_relative_path = field.text().await.ok();
            continue;
        }

        // Determine the save path: use relative_path if provided, else just file_name
        let save_name = if let Some(ref rel_path) = pending_relative_path {
            // Sanitize relative path to prevent path traversal
            rel_path
                .replace('\\', "/")
                .split('/')
                .filter(|s| !s.is_empty() && *s != ".." && *s != ".")
                .collect::<Vec<_>>()
                .join("/")
        } else {
            field.file_name().map_or_else(
                || format!("upload_{}", Uuid::new_v4()),
                std::string::ToString::to_string,
            )
        };
        pending_relative_path = None; // Reset for next iteration

        // ⚠️ 每一個檔案都要**先原子性地佔一個名額**，寫檔在後。
        //
        // 原本的檢查有兩個洞：
        //  1. 它在迴圈**外面**只做一次。限制 5 個檔案的連結，一個 multipart
        //     請求塞 100 個檔案會全部被收下 —— 而這條端點不需要登入。
        //  2. 它是 check-then-act。兩個並行請求會讀到同一個 uploaded_count，
        //     一起通過檢查，一起上傳。
        //
        // 條件式 UPDATE 把「檢查」與「增加」變成一個動作；rows_affected 為 0
        // 就表示名額用完了。SQLite 的單一 UPDATE 是原子的。
        let reserved = sqlx::query(
            "UPDATE upload_links SET uploaded_count = uploaded_count + 1
             WHERE id = ? AND (max_files IS NULL OR uploaded_count < max_files)",
        )
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(AppError::from)?;

        if reserved.rows_affected() == 0 {
            return Err(AppError::Status(StatusCode::TOO_MANY_REQUESTS));
        }

        // ⚠️ save_name 在沒有 relative_path 欄位時就是 multipart 的 `filename`，
        // 一個字元都沒過濾，而這條端點**完全不需要登入**。
        // `filename="../../../x"` 等於以 server 身分任意寫檔。
        //
        // target_path 跟 save_name 一起 resolve，這樣 `a/../..` 這種跨段的
        // 組合也擋得住。兩者都算請求內容，所以統一回 400。
        let full_path = state
            .storage_path
            .resolve(&format!("{target_path}/{save_name}"))
            .map_err(|_| AppError::Status(StatusCode::BAD_REQUEST))?;

        // 確保目標目錄存在
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        }

        // ⚠️ 先寫到**同一個目錄底下**的暫存檔，完整寫完才 rename 過去。
        //
        // 原本是直接 `File::create(full_path)` 就地寫，只有「超過大小上限」那條
        // 路徑會把半成品收掉。其餘任何失敗 —— 磁碟滿、I/O 錯誤、客戶端傳到一半
        // 斷線 —— 都會把一個殘缺的檔案留在使用者的資料夾裡，而且**這條端點
        // 不需要登入**：任何拿到連結的人斷線一次就留下一個壞檔。
        //
        // 暫存檔放同目錄：跨檔案系統的 rename 不是原子的，也可能直接 EXDEV。
        // 這跟 tus 與舊的分塊上傳現在是同一個做法。
        // 檔名以 `.` 開頭 —— 索引器的 watcher 會跳過它，不然大檔案上傳期間
        // 使用者會在列表裡看到一個 `.part-…` 的項目（見 tus.rs 的同一段說明）。
        let temp_path = full_path.with_file_name(format!(
            ".{}.part-{}",
            full_path.file_name().unwrap_or_default().to_string_lossy(),
            Uuid::new_v4()
        ));

        let mut file = fs::File::create(&temp_path)
            .await
            .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        let mut total_bytes: i64 = 0;

        // 任何一步失敗都要把半成品收掉，然後才把錯誤丟出去。
        macro_rules! bail {
            ($status:expr) => {{
                drop(file);
                let _ = fs::remove_file(&temp_path).await;
                return Err(AppError::Status($status));
            }};
        }

        loop {
            let next = field.chunk().await;
            let chunk = match next {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => {
                    tracing::error!("Chunk read error: {:?}", e);
                    bail!(StatusCode::BAD_REQUEST);
                }
            };

            total_bytes += i64::try_from(chunk.len()).unwrap_or(i64::MAX);

            // 檢查檔案大小限制
            if let Some(max_size) = max_file_size {
                if total_bytes > max_size {
                    bail!(StatusCode::PAYLOAD_TOO_LARGE);
                }
            }

            if file.write_all(&chunk).await.is_err() {
                bail!(StatusCode::INTERNAL_SERVER_ERROR);
            }
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
        if file.flush().await.is_err() {
            drop(file);
            let _ = fs::remove_file(&temp_path).await;
            return Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR));
        }

        // 資料完整地躺在暫存檔裡了，這時才動最終路徑。
        drop(file);
        if let Err(e) = fs::rename(&temp_path, &full_path).await {
            tracing::error!("上傳連結落地失敗（{full_path:?}）：{e}");
            let _ = fs::remove_file(&temp_path).await;
            return Err(AppError::Status(StatusCode::INTERNAL_SERVER_ERROR));
        }

        files_uploaded += 1;
    }

    // 計數在迴圈裡就已經逐檔加過了（見上面的「預約」），這裡不能再加一次。

    Ok(Json(serde_json::json!({
        "success": true,
        "files_uploaded": files_uploaded
    })))
}
