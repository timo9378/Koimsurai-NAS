use crate::error::AppError;
use crate::models::job::Job;
use crate::state::AppState;
use axum::{extract::State, Json};

#[utoipa::path(
    get,
    path = "/api/tasks",
    responses(
        (status = 200, description = "List active tasks", body = Vec<Job>)
    )
)]
pub async fn list_jobs(State(state): State<AppState>) -> Result<Json<Vec<Job>>, AppError> {
    let jobs = sqlx::query_as::<_, Job>("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
        .fetch_all(&state.pool)
        .await
        .map_err(AppError::from)?;

    Ok(Json(jobs))
}
