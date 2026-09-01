//! 路由註冊與 `OpenAPI` 文件定義。
//
// needless_for_each 由 utoipa 的 `#[derive(OpenApi)]` 展開產生，不是這個檔案
// 寫出來的程式碼。⚠️ 掛在 item 上的 `#[allow]` 對 derive 展開無效（實測 -D warnings
// 仍會擋），必須放模組層級。上游改寫之後可以拿掉。
#![allow(clippy::needless_for_each, reason = "utoipa OpenApi derive 的巨集展開")]

use crate::handlers::report_tunnel;
use crate::handlers::{
    audit, auth, docker, file, job, media, permission, search, share, system, tag, terminal, trash, tus,
    upload, upload_link, version, webdav, ws,
};
use crate::middleware::auth::require_auth;
use crate::state::AppState;
use axum::{
    extract::DefaultBodyLimit,
    http::Method,
    middleware,
    routing::{any, delete, get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::SqliteStore;
use utoipa::{Modify, OpenApi};
use utoipa_scalar::{Scalar, Servable};

use crate::handlers::media::TimelineGroup;
use crate::handlers::system::{ConsistencyCheckResult, DiskInfo, RescanResult, SystemStatus};
use crate::handlers::tag::AddTagRequest;
use crate::models::{
    CreateShareLinkRequest, EmptyResponse, FileInfo, InitUploadRequest, InitUploadResponse, LoginRequest,
    LoginResponse, RegisterRequest, ShareLinkResponse, Tag, TwoFactorDisableRequest, TwoFactorLoginRequest,
    TwoFactorSetupResponse, TwoFactorStatusResponse, TwoFactorVerifySetupRequest,
    TwoFactorVerifySetupResponse, UploadSession, User,
};
use crate::services::audit::AuditLog;
use crate::services::search::SearchResult;
use crate::utils::versioning::FileVersion;

/// 把每個端點都可能回的錯誤狀態碼補進 `OpenAPI` spec。
///
/// ⚠️ 為什麼用 `Modify` 而不是逐支加 `responses(...)`：46 個 operation 裡只有
/// 6 個記載了 401、**0 個記載 500**，而這些不是各端點特有的行為 ——
/// 它們來自共用的機制：
///   - `require_auth` 可以讓**任何**受保護的端點回 401／403
///   - `AppError` 的 `IntoResponse` 可以讓任何 handler 回 400／404／500
///
/// 逐支複製同一組標註，只會變成 46 份會各自走鐘的重複。
///
/// ⚠️ 這是**超集**：公開端點（登入、註冊、分享連結）其實不會回 401。
/// 之所以接受這個不精確，是因為反方向的代價比較大 —— schemathesis 檢查的是
/// 「收到了文件沒寫的狀態碼」，多寫不會誤報，少寫會讓 45 個真實回應被當成
/// 失敗，而那會淹掉真正的問題。要更精確的話得在這裡維護一份公開路徑清單，
/// 那份清單本身又會跟路由走鐘。
struct CommonErrorResponses;

impl Modify for CommonErrorResponses {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::{RefOr, ResponseBuilder};

        let common: [(&str, &str); 7] = [
            ("400", "請求格式錯誤"),
            // ⚠️ 422 是 axum 的 `Json<T>` extractor 在 body 反序列化失敗時回的
            // ——跟 400 一樣是框架層級、每個吃 JSON 的端點都可能回。
            ("422", "請求內容無法解析"),
            ("401", "未登入或憑證無效"),
            ("403", "沒有權限（含 CSRF 檢查未通過）"),
            ("404", "找不到"),
            // ⚠️ 405 由 axum 的路由器產生（路徑存在但方法沒註冊），
            // 不是任何 handler 寫出來的。
            ("405", "方法不被支援"),
            ("500", "伺服器內部錯誤"),
        ];

        for item in openapi.paths.paths.values_mut() {
            // utoipa 5 的 PathItem 是每個方法一個 Option<Operation> 的欄位，
            // 沒有可以直接走訪的集合。
            let operations = [
                item.get.as_mut(),
                item.put.as_mut(),
                item.post.as_mut(),
                item.delete.as_mut(),
                item.patch.as_mut(),
                item.head.as_mut(),
                item.options.as_mut(),
                item.trace.as_mut(),
            ];
            for operation in operations.into_iter().flatten() {
                for (code, description) in common {
                    // 已經逐支寫過的不要蓋掉 —— 那些描述比這裡的通用文字精確
                    operation
                        .responses
                        .responses
                        .entry(code.to_string())
                        .or_insert_with(|| RefOr::T(ResponseBuilder::new().description(description).build()));
                }
            }
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        auth::register,
        auth::login,
        auth::logout,
        auth::refresh,
        auth::two_factor_login,
        auth::two_factor_setup,
        auth::two_factor_verify_setup,
        auth::two_factor_disable,
        auth::two_factor_status,
        file::list_files_root,
        file::list_files,
        file::list_favorites,
        file::create_folder,
        file::download_file,
        file::upload_file_root,
        file::upload_file,
        file::get_thumbnail,
        file::delete_file,
        file::batch_delete,
        file::batch_move,
        tus::options,
        tus::create,
        tus::status,
        tus::append,
        tus::terminate,
        file::batch_copy,
        trash::list_trash,
        trash::restore_file,
        trash::empty_trash,
        share::create_share_link,
        share::access_share_link,
        system::get_system_status,
        system::verify_consistency,
        system::trigger_rescan,
        job::list_jobs,
        upload::init_upload,
        upload::upload_chunk,
        upload::get_upload_status,
        tag::add_tag,
        tag::remove_tag,
        tag::toggle_star,
        tag::list_tags,
        tag::list_files_by_tag,
        audit::list_audit_logs,
        audit::delete_audit_log,
        audit::clear_audit_logs,
        version::list_file_versions,
        version::restore_version,
        search::search_files,
        media::stream_media,
        media::get_timeline
    ),
    components(
        schemas(RegisterRequest, LoginRequest, EmptyResponse, FileInfo, User, CreateShareLinkRequest, ShareLinkResponse, SystemStatus, DiskInfo, ConsistencyCheckResult, RescanResult, InitUploadRequest, InitUploadResponse, UploadSession, Tag, AddTagRequest, AuditLog, FileVersion, SearchResult, TimelineGroup, LoginResponse, TwoFactorLoginRequest, TwoFactorSetupResponse, TwoFactorVerifySetupRequest, TwoFactorVerifySetupResponse, TwoFactorDisableRequest, TwoFactorStatusResponse, crate::handlers::file::BatchOperationRequest, crate::handlers::file::FavoriteFileInfo, crate::handlers::file::CreateFolderRequest, crate::handlers::tag::UserTag, crate::handlers::tag::TaggedFile)
    ),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "file", description = "File management endpoints"),
        (name = "share", description = "Share link endpoints"),
        (name = "system", description = "System monitoring endpoints"),
        (name = "audit", description = "Audit log endpoints"),
        (name = "search", description = "Search endpoints"),
        (name = "tags", description = "Tag management endpoints"),
        (name = "tus", description = "tus 1.0.0 可續傳上傳（見 handlers/tus.rs）")
    ),
    modifiers(&CommonErrorResponses)
)]
pub struct ApiDoc;

pub async fn create_router(state: AppState) -> Router {
    // Session store (SqliteStore for persistence)
    let session_store = SqliteStore::new(state.pool.clone());
    // 啟動期的 fail-fast：session 表建不起來就沒有登入可言，讓行程直接退出
    // 比帶著壞掉的 session store 服務請求好。（同 main.rs 的 expect ×2）
    session_store
        .migrate()
        .await
        .expect("session store migration failed");

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false) // Set to true in production with HTTPS
        .with_expiry(Expiry::OnInactivity(
            tower_sessions::cookie::time::Duration::seconds(3600),
        ));

    // 2FA routes 需要登入（require_auth），而 /2fa/login 是公開的（用 temp_token）
    let two_factor_protected = Router::new()
        .route("/2fa/setup", post(auth::two_factor_setup))
        .route("/2fa/verify-setup", post(auth::two_factor_verify_setup))
        .route("/2fa/disable", post(auth::two_factor_disable))
        .route("/2fa/status", get(auth::two_factor_status))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let auth_routes = Router::new()
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/refresh", post(auth::refresh))
        .route("/2fa/login", post(auth::two_factor_login))
        .merge(two_factor_protected);

    let file_routes = Router::new()
        .route("/files", get(file::list_files_root))
        .route("/files/folder", post(file::create_folder))
        .route("/favorites", get(file::list_favorites))
        .route("/files/batch/delete", post(file::batch_delete))
        .route("/files/batch/move", post(file::batch_move))
        .route("/files/batch/copy", post(file::batch_copy))
        .route("/upload/init", post(upload::init_upload))
        .route(
            "/upload/session/{id}",
            axum::routing::patch(upload::upload_chunk).get(upload::get_upload_status),
        )
        .route("/upload", post(file::upload_file_root))
        .route("/upload/{*path}", post(file::upload_file))
        .route("/download/{*path}", get(file::download_file))
        .route("/thumbnail/{size}/{*path}", get(file::get_thumbnail))
        // Tags
        .route("/tags", get(tag::list_tags))
        .route("/tags/{tag_name}/files", get(tag::list_files_by_tag))
        .route("/tags/add/{*path}", post(tag::add_tag))
        .route(
            "/tags/remove/{tag_name}/{*path}",
            axum::routing::delete(tag::remove_tag),
        )
        .route("/star/file/{*path}", post(tag::toggle_star))
        .route("/versions/file/{*path}", get(version::list_file_versions))
        .route(
            "/versions/restore/{version_id}/{*path}",
            post(version::restore_version),
        )
        .route(
            "/files/{*path}",
            get(file::list_files)
                .delete(file::delete_file)
                .put(file::rename_file),
        )
        .route("/share", post(share::create_share_link))
        .route("/upload-link", post(upload_link::create_upload_link))
        .route("/system/status", get(system::get_system_status))
        // 系統管理端點 (適合在 DB 還原後執行)
        .route("/system/verify-consistency", post(system::verify_consistency))
        .route("/system/rescan", post(system::trigger_rescan))
        // 媒體串流
        .route("/media/stream", get(media::stream_media))
        .route("/media/timeline", get(media::get_timeline))
        // HLS 串流
        .route("/media/hls/status", get(media::hls_status))
        .route("/media/hls/serve", get(media::hls_serve))
        .route("/media/hls/qualities", get(media::hls_qualities))
        // 其他
        .route("/trash", get(trash::list_trash))
        .route(
            "/trash/{filename}",
            post(trash::restore_file).delete(trash::permanent_delete),
        )
        .route("/trash", axum::routing::delete(trash::empty_trash))
        .route("/permissions", post(permission::set_permission))
        .route("/tasks", get(job::list_jobs))
        .route("/terminal", get(terminal::terminal_handler))
        .route("/ws", get(ws::ws_handler))
        .route(
            "/audit/logs",
            get(audit::list_audit_logs).delete(audit::clear_audit_logs),
        )
        .route("/audit/logs/{id}", axum::routing::delete(audit::delete_audit_log))
        .route("/search", get(search::search_files))
        .route("/search/ai-tags", get(search::search_ai_tags))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth)) // Protect file routes
        // 設置上傳大小限制為 10GB
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)); // 10GB

    // Docker 管理路由（需要認證）
    let docker_routes = Router::new()
        .route("/status", get(docker::docker_status))
        .route("/connect", post(docker::docker_connect))
        // 容器操作
        .route("/containers", get(docker::list_containers))
        .route(
            "/containers/{id}",
            get(docker::inspect_container).delete(docker::remove_container),
        )
        .route("/containers/{id}/start", post(docker::start_container))
        .route("/containers/{id}/stop", post(docker::stop_container))
        .route("/containers/{id}/restart", post(docker::restart_container))
        .route("/containers/{id}/logs", get(docker::container_logs))
        .route("/containers/{id}/stats", get(docker::container_stats))
        .route("/containers/{id}/exec", get(docker::container_exec)) // WebSocket route
        // 鏡像操作
        .route("/images", get(docker::list_images))
        .route("/images/pull", post(docker::pull_image))
        .route("/images/{id}", delete(docker::remove_image))
        // 網絡操作
        .route("/networks", get(docker::list_networks))
        // ⚠️ 順序：layer 是**由外往內**套的，寫在後面的先執行。
        // require_auth 必須先跑（它把 user_id 放進 extensions），
        // require_docker_admin 才讀得到 —— 所以 admin 那道寫在前面。
        .layer(middleware::from_fn(
            crate::middleware::docker_admin::require_docker_admin,
        ))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth)); // Protect docker routes

    // Configure CORS for direct frontend-to-backend requests (e.g., file uploads)
    // Note: allow_credentials cannot be used with allow_origin(Any)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // API 文件（需要登入）
    //
    // ⚠️ 這道 layer 不能省。掛在 router 根層而沒有 require_auth 的話，
    // `https://<host>/scalar` 對任何人都是 200 —— 完整的端點清單、參數、
    // schema 全部攤開給人看。那不是漏洞，但它把攻擊面整理好送到對方手上，
    // 而這台是對外開放的。
    //
    // ⚠️ ApiDoc::openapi() 產生的 spec **本身**就在 binary 裡，這道 layer
    // 擋的是「不用登入就讀得到」。真的要讓 production 完全沒有這份文件，
    // 得改成 feature flag 在編譯期拿掉。
    let docs_routes = Router::new()
        .merge(Scalar::with_url("/scalar", ApiDoc::openapi()))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .merge(docs_routes)
        .nest("/api/auth", auth_routes)
        .nest("/api", file_routes)
        .nest("/api/docker", docker_routes)
        .route("/api/share/{id}/download", get(share::access_share_link)) // Public share link - download
        .route("/api/share/{id}/info", get(share::get_share_info)) // Public share link - info
        .merge(
            Router::new()
                .route("/api/upload-link/{id}/upload", post(upload_link::upload_via_link))
                .layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)), // 10GB for public uploads
        )
        .route(
            "/api/upload-link/{id}/info",
            get(upload_link::get_upload_link_info),
        ) // Public upload link - info
        // Public health check for uptime monitoring (no auth, returns 200)
        .route("/health", get(|| async { "OK" }))
        // 前端錯誤回報的轉發端點（Sentry SDK 的 tunnel 目的地）。
        // ⚠️ 刻意無認證：錯誤可能發生在登入之前。防濫用見該 handler 的說明。
        .route("/api/_report", post(report_tunnel::tunnel))
        .layer(cors)
        // ── tus 1.0.0（可續傳上傳）────────────────────────────────
        //
        // ⚠️ **刻意掛在 `.layer(cors)` 之後**，也就是不吃 CORS layer。
        //
        // tower-http 的 CorsLayer 會短路掉**每一個** OPTIONS 請求，不管它是不是
        // 真的 preflight（見它 cors/mod.rs 裡的 `if parts.method ==
        // Method::OPTIONS`）。而 tus 的能力探索就是一個 OPTIONS ——
        // 掛在 CORS 底下的話，`Tus-Version` / `Tus-Extension` 永遠送不出去，
        // 非瀏覽器的客戶端就無從得知伺服器支援哪些擴充。
        //
        // 不吃 CORS 的代價是零：這個 CORS 設定是 `allow_origin(Any)` 且沒有
        // allow_credentials，而本 API 是 cookie 認證 —— 瀏覽器在那個組合下
        // 本來就不會送 cookie，跨來源呼叫從來就不成立。SPA 現在也是由這個
        // binary 同源供應的。
        //
        // ⚠️ 路徑要跟 handlers/tus.rs 的 BASE_PATH 一致（"/api/tus"），
        // 否則 crate 產生的 Location 會指到不存在的位置，而客戶端會
        // 安靜地續傳失敗（不是報錯，是每次都從頭傳）。
        .merge(
            Router::new()
                .route("/api/tus", axum::routing::options(tus::options).post(tus::create))
                .route(
                    "/api/tus/{id}",
                    axum::routing::head(tus::status)
                        .patch(tus::append)
                        .delete(tus::terminate),
                )
                // ⚠️ `route_layer` 而不是 `layer`。
                //
                // `layer` 會把 middleware 套到這個 router 的**所有請求**上，
                // 包含它的 fallback —— 而這個 router 是 merge 到根層的，
                // 於是「沒對到任何路由」的請求也會走 require_auth，
                // 所有未知的 /api/* 從 404 變成 401。
                //
                // 那個回歸只在**沒設 STATIC_DIR** 時看得見（有 SPA fallback 時
                // 會先被它接走），所以 E2E 是綠的，卻讓 api-fuzz 的
                // readiness 探測（等 /api/nope 回 404）整整等了 60 秒然後失敗。
                //
                // `route_layer` 只套在**有對到**的路由上，正是 auth middleware
                // 該有的行為。
                .route_layer(middleware::from_fn_with_state(state.clone(), require_auth))
                .layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)),
        )
        // ── WebDAV ───────────────────────────────────────────────
        //
        // ⚠️ 這兩條原本掛在根 router 上、**不在任何 auth layer 底下**，
        // 於是完全不需要憑證就能對整個儲存空間讀寫刪列目錄
        // （`GET /webdav/../任何檔案` 直接回 200）。詳見 handlers/webdav.rs。
        //
        // 跟 tus 同樣的理由掛在 cors 之後：CorsLayer 會短路掉每一個 OPTIONS，
        // 而 WebDAV 的能力探索就是 OPTIONS。
        //
        // ⚠️ `route_layer` 而不是 `layer` —— 後者會連 fallback 一起包住，
        // 讓所有未對到的路徑變成 401（這個坑今天已經踩過一次）。
        .merge(
            Router::new()
                .route(webdav::MOUNT_PATH, any(webdav::webdav_handler))
                // ⚠️ 結尾斜線要獨立一條。`{*path}` 匹配不到空 segment，
                // 所以 `/webdav/` 會落到 fallback 變成 404 —— 而 WebDAV 客戶端
                // 請求集合根時送的就是這個形式。少了它既是功能缺口，
                // 那條路徑也不會經過下面的 auth layer。
                .route(&format!("{}/", webdav::MOUNT_PATH), any(webdav::webdav_handler))
                .route(
                    &format!("{}/{{*path}}", webdav::MOUNT_PATH),
                    any(webdav::webdav_handler),
                )
                .route_layer(middleware::from_fn_with_state(state.clone(), require_auth))
                .layer(DefaultBodyLimit::max(10 * 1024 * 1024 * 1024)),
        )
        .layer(session_layer)
        .with_state(state)
}
