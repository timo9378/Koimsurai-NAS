use axum::{response::{IntoResponse, Response}, http::StatusCode, Json};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    AuthError(String),
    DatabaseError(sqlx::Error),
    Anyhow(anyhow::Error),
    Status(StatusCode),
    IoError(std::io::Error),
    Custom(StatusCode, String),
    InternalServerError(String),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::DatabaseError(err)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        Self::Anyhow(err)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err)
    }
}

impl From<tower_sessions::session::Error> for AppError {
    fn from(err: tower_sessions::session::Error) -> Self {
        Self::Anyhow(anyhow::Error::new(err))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::AuthError(msg) => (StatusCode::UNAUTHORIZED, msg),
            Self::DatabaseError(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            Self::Anyhow(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            Self::Status(s) => (s, s.to_string()),
            Self::IoError(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            Self::Custom(s, msg) => (s, msg),
            Self::InternalServerError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(json!({
            "error": message
        }));

        (status, body).into_response()
    }
}
