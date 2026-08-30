use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Request, State},
    response::IntoResponse,
};

pub async fn webdav_handler(State(state): State<AppState>, req: Request<Body>) -> impl IntoResponse {
    state.webdav.handle(req).await
}
