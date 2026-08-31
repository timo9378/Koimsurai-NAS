//! 路徑權限。
//!
//! ⚠️ 這個端點原本**完全沒有授權檢查**：呼叫者的 `user_id` 被顯式忽略
//! （原本的註解就寫著 "In real app, check if user is admin"），而
//! `payload.user_id` 是客戶端說了算的。於是任何已登入的使用者都能替
//! **任何人**設定任何路徑的權限。
//!
//! 具體的攻擊：`permissions` 只在「有一列而且值是 false」時才拒絕，
//! 所以
//!
//! ```json
//! POST /api/permissions
//! { "user_id": <受害者>, "path": "", "can_read": false, "can_write": false }
//! ```
//!
//! 會讓受害者在根目錄失去讀寫權限 —— 一個一般帳號就能把別人（包含站主）
//! 鎖在門外。`permissions` 被 `file.rs` 與 `media.rs` 的五處檢查讀取。
//!
//! ## 為什麼是「只能設定自己的」而不是「只有管理員能設定」
//!
//! `users` 表**沒有** `role`／`is_admin` 欄位 —— 管理員這個概念在這個系統裡
//! 還不存在。要做出來得決定「誰是管理員」（第一個註冊的人？環境變數？），
//! 那是產品設計而不是修漏洞，不該在修安全問題時順手決定。
//!
//! 限制成「只能設定自己的」removes 掉跨使用者的攻擊，而且不會弄壞任何東西：
//! 前端從來沒有呼叫過這個端點，跨使用者的管理流程也從未實作 ——
//! 它一直只是攻擊面。
//!
//! 真正的權限管理功能要等 role 概念先存在。

use crate::error::AppError;
use crate::models::CreatePermissionRequest;
use crate::state::AppState;
use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
};

pub async fn set_permission(
    State(state): State<AppState>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreatePermissionRequest>,
) -> Result<StatusCode, AppError> {
    // ⚠️ 見模組說明：沒有這一行，任何登入者都能改別人的權限。
    if payload.user_id != user_id {
        return Err(AppError::Status(StatusCode::FORBIDDEN));
    }

    sqlx::query(
        r"
        INSERT INTO permissions (user_id, path, can_read, can_write)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, path) DO UPDATE SET
            can_read = excluded.can_read,
            can_write = excluded.can_write
        ",
    )
    .bind(payload.user_id)
    .bind(&payload.path)
    .bind(payload.can_read)
    .bind(payload.can_write)
    .execute(&state.pool)
    .await
    .map_err(AppError::from)?;

    Ok(StatusCode::OK)
}
