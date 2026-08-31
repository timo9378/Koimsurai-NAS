//! Docker 管理的授權檢查。
//!
//! ⚠️ `require_auth` 只證明「這是一個登入的使用者」。Docker 管理需要的不只
//! 這個：容器掛著 `/var/run/docker.sock`、`pid: host`，而
//! `POST /api/docker/containers/{id}/exec` 吃客戶端給的 `cmd`
//! （預設 `/bin/sh`）在**任意**容器裡執行。也就是說，能打到這批端點
//! 就等於拿到**主機 root** —— 而且還能直接起一個特權容器把 `/` 掛進去。
//!
//! 稽核時實測：production 上有三個帳號，在加上這道檢查之前三個都做得到。
//!
//! 允許清單來自 `DOCKER_MANAGER_USER_IDS`，**沒設就全部拒絕**
//! （見 `state::get_docker_manager_user_ids` 的說明）。

use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};

use crate::state::get_docker_manager_user_ids;

pub async fn require_docker_admin(request: Request, next: Next) -> Result<Response, StatusCode> {
    // ⚠️ 這道一定要排在 require_auth **後面** —— user_id 是那道塞進 extensions 的。
    // 順序反了的話這裡永遠拿不到 id，於是永遠 403，症狀是「Docker 管理整個壞掉」。
    let user_id = request
        .extensions()
        .get::<i64>()
        .copied()
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if get_docker_manager_user_ids().contains(&user_id) {
        Ok(next.run(request).await)
    } else {
        tracing::warn!("使用者 {user_id} 嘗試存取 Docker 管理端點但不在允許清單裡");
        Err(StatusCode::FORBIDDEN)
    }
}
