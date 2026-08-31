//! tus 1.0.0 —— 可續傳上傳協定。
//!
//! # 為什麼是自己接 HTTP 層
//!
//! 這裡只用 `tus-protocol`（純協定核心），不用 `tus-axum` / `tus-server`。
//! 後兩者會拖進 **67 個 crate** —— opendal、aws-lc-sys（要 cmake 的 C/組語
//! 密碼庫）、jni（Java Native Interface）、clap。為了續傳上傳把那些放進建置
//! 相依完全不成比例。`tus-protocol` 單獨加只多一個 crate、零傳遞相依。
//!
//! 代價是這支檔案：HTTP 動詞 → 協定呼叫的轉接，大約一百行。換到的是
//! **完成後的落地流程仍然在我們手上** —— 檔案要落到哪、要不要建版本、
//! 要不要進索引，全都走既有的 `StorageRoot::resolve`，而不是由第三方
//! crate 的 storage 抽象決定。
//!
//! # 與既有 `/api/upload/*` 的關係
//!
//! 兩套並存。舊的那套（`handlers/upload.rs`）沒有動，前端沿用中；
//! tus 這套是新的、標準的那條路，前端之後改用 `tus-js-client`。
//! 全部切換完再考慮把舊的下線。
//!
//! # 落地流程
//!
//! tus 的暫存區在 `<storage>/.tus`。上傳完成（`Upload-Offset == Upload-Length`）
//! 之後由 [`finalize`] 把內容搬到使用者指定的路徑：
//!
//! ```text
//! PATCH .../<id>  →  offset == length  →  finalize()
//!                                          ├─ resolve(metadata.path/filename)  ← 走 StorageRoot
//!                                          ├─ 串流複製到目的地
//!                                          ├─ 寫 files 資料表
//!                                          └─ DELETE 掉 tus 的暫存
//! ```
//!
//! ⚠️ 目的地路徑來自客戶端送的 `Upload-Metadata`，所以**一定**要走
//! `StorageRoot::resolve` —— 那是本專案修過六個路徑逃逸漏洞之後的唯一入口。

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response as AxumResponse};
use futures::StreamExt as _;
use tokio::io::AsyncWriteExt as _;
use tus_protocol::locking::memory::MemoryLocker;
use tus_protocol::state::file::FileStateStore;
use tus_protocol::storage::file::FileStorage;
use tus_protocol::{
    Config, Extension, Headers, NoopHookExecutor, ProtocolHandle, RequestBody, Response, UploadId,
};

use crate::error::AppError;
use crate::state::AppState;
use crate::storage::StorageRoot;

/// 這個服務對外掛在哪一段路徑。要跟 `routes/mod.rs` 的 nest 一致，
/// 否則 `Location` 標頭會指到不存在的位置，而客戶端會安靜地續傳失敗。
pub const BASE_PATH: &str = "/api/tus";

/// tus 的暫存區（在儲存根底下，跟 `.trash` / `.hls_cache` 同層）。
const TUS_DIR: &str = ".tus";

pub type TusHandle = ProtocolHandle<FileStorage, FileStateStore, MemoryLocker, NoopHookExecutor>;

/// 建立協定 handle。在 `create_app` 裡叫一次。
///
/// # Errors
/// 暫存目錄建不出來時回錯（磁碟滿了、權限不對）。
pub async fn build(storage: &StorageRoot) -> anyhow::Result<Arc<TusHandle>> {
    let root = storage.internal(TUS_DIR);
    let file_storage = FileStorage::new(root.join("data")).await?;
    let state_store = FileStateStore::new(root.join("state")).await?;

    let config = Config::new()
        .with_base_path(BASE_PATH)
        .with_extension(Extension::Creation)
        .with_extension(Extension::CreationWithUpload)
        .with_extension(Extension::Termination)
        // ⚠️ 沒有過期就沒有回收：中斷的上傳會永遠佔著磁碟。一天之後可回收。
        .with_expiration(std::time::Duration::from_hours(24));

    Ok(Arc::new(ProtocolHandle::new(
        config,
        file_storage,
        state_store,
        MemoryLocker::new(),
        NoopHookExecutor,
    )))
}

/// tus 的 `Response` → axum 的 `Response`。
fn to_axum(r: Response) -> AxumResponse {
    let mut out = AxumResponse::builder().status(r.status);
    if let Some(h) = out.headers_mut() {
        *h = r.headers;
    }
    out.body(Body::from(r.body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// tus 的 `Error` → axum 的 `Response`。
///
/// ⚠️ 走 crate 自己的 `ErrorResponse` 而不是自己對照狀態碼：協定規定了
/// 每種錯誤該回什麼（例如 offset 對不上是 409、版本不符是 412），
/// 自己抄一份就是抄錯的開始。
fn err_to_axum(e: &tus_protocol::Error) -> AxumResponse {
    let er = e.error_response();
    // ⚠️ 狀態碼是 u16 而不是 StatusCode —— tus 用了 IANA 沒登記的碼
    // （例如 460 Checksum Mismatch），crate 的註解特別說明了這件事。
    let status = StatusCode::from_u16(er.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut out = AxumResponse::builder().status(status);
    for (k, v) in er.headers {
        out = out.header(k, v);
    }
    out.body(Body::from(er.body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

// ⚠️ Err 包一層 Box：clippy 的 result_large_err 會擋 —— `axum::Response`
// 至少 128 bytes，而這兩支是 hot path 上每個請求都會呼叫的。
fn headers_of(h: &HeaderMap) -> Result<Headers, Box<AxumResponse>> {
    Headers::from_headers(h).map_err(|e| Box::new(err_to_axum(&e)))
}

fn id_of(raw: &str) -> Result<UploadId, Box<AxumResponse>> {
    raw.parse::<UploadId>().map_err(|e| Box::new(err_to_axum(&e)))
}

pub async fn options(State(state): State<AppState>) -> AxumResponse {
    to_axum(state.tus.options())
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> AxumResponse {
    let h = match headers_of(&headers) {
        Ok(h) => h,
        Err(r) => return *r,
    };
    match state.tus.post(h, body_of(&headers, body)).await {
        Ok(r) => to_axum(r),
        Err(e) => err_to_axum(&e),
    }
}

/// ⚠️ 「沒有 body」跟「body 是空的」在 tus 裡是**不同**的兩件事。
///
/// `RequestBody::empty()` 表示客戶端送了一個長度為 0 的 body，於是協定會把
/// 這次 POST 當成 creation-with-upload，接著要求 `Content-Type:
/// application/offset+octet-stream` —— 少了它就是 415。
/// 單純建立上傳（沒有初始資料）必須用 `absent()`。
///
/// axum 的 `Bytes` 抽取器在沒有 body 時給的是空的 `Bytes`，兩者長得一樣，
/// 所以要靠 Content-Type 來分。
fn body_of(headers: &HeaderMap, body: axum::body::Bytes) -> RequestBody {
    const OFFSET_OCTET_STREAM: &str = "application/offset+octet-stream";
    let is_upload = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with(OFFSET_OCTET_STREAM));

    if is_upload {
        RequestBody::from_bytes(body)
    } else {
        RequestBody::absent()
    }
}

pub async fn status(State(state): State<AppState>, AxumPath(id): AxumPath<String>) -> AxumResponse {
    let uid = match id_of(&id) {
        Ok(v) => v,
        Err(r) => return *r,
    };
    match state.tus.head(&uid).await {
        Ok(r) => to_axum(r),
        Err(e) => err_to_axum(&e),
    }
}

pub async fn terminate(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> AxumResponse {
    let (h, uid) = match (headers_of(&headers), id_of(&id)) {
        (Ok(h), Ok(u)) => (h, u),
        (Err(r), _) | (_, Err(r)) => return *r,
    };
    match state.tus.delete(h, &uid).await {
        Ok(r) => to_axum(r),
        Err(e) => err_to_axum(&e),
    }
}

pub async fn append(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> AxumResponse {
    let (h, uid) = match (headers_of(&headers), id_of(&id)) {
        (Ok(h), Ok(u)) => (h, u),
        (Err(r), _) | (_, Err(r)) => return *r,
    };

    let res = match state.tus.patch(h, &uid, body_of(&headers, body)).await {
        Ok(r) => r,
        Err(e) => return err_to_axum(&e),
    };

    // 傳完了就落地。
    //
    // ⚠️ 判斷「傳完了沒」要看 **HEAD**，不能看 PATCH 的回應。tus 規定 PATCH
    // 只回 `Upload-Offset`，**不回** `Upload-Length` —— 拿 PATCH 的標頭去比
    // 的話 `is_complete` 永遠是 false，落地永遠不會發生。
    //
    // 這個 bug 一開始沒被抓到，因為兩支路徑逃逸的測試「通過」了：
    // 檔案根本沒被寫出去，所以當然也沒逃出去。是「檔案應該落在儲存根」
    // 那兩條測試把它揪出來的。
    let meta = match state.tus.head(&uid).await {
        Ok(m) => m,
        Err(e) => return err_to_axum(&e),
    };
    if is_complete(&meta) {
        if let Err(e) = finalize(&state, &uid, &meta).await {
            tracing::error!("tus 上傳落地失敗（id={}）：{:?}", uid.as_str(), e);
            return e.into_response();
        }
    }
    to_axum(res)
}

/// HEAD 回應裡的 `Upload-Offset` 是否已經等於 `Upload-Length`。
fn is_complete(res: &Response) -> bool {
    let num = |k: &str| {
        res.headers
            .get(k)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
    };
    match (num("upload-offset"), num("upload-length")) {
        (Some(offset), Some(length)) => offset == length,
        _ => false,
    }
}

/// 把完成的上傳搬進使用者的儲存空間，然後清掉 tus 的暫存。
async fn finalize(state: &AppState, uid: &UploadId, meta: &Response) -> Result<(), AppError> {
    // Upload-Metadata 是客戶端說了算的 —— 一定要走 resolve。
    let relative = metadata_target(meta).ok_or(AppError::Status(StatusCode::BAD_REQUEST))?;
    let dest = state.storage_path.resolve(&relative)?;

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
    }

    let download = state
        .tus
        .download(tus_protocol::DownloadRequest::new(uid))
        .await
        .map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;

    let mut file = tokio::fs::File::create(&dest).await.map_err(AppError::from)?;
    let mut stream = download.body;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
        file.write_all(&chunk).await.map_err(AppError::from)?;
    }
    // ⚠️ 一定要 flush —— tokio 的 File 在 drop 時不保證資料已經寫出去，
    // 而且 drop 途中的寫入錯誤會被吞掉。本專案已經因為這件事踩過三次。
    file.flush().await.map_err(AppError::from)?;

    // 搬完就把 tus 的暫存清掉，否則同一份資料會佔兩份磁碟。
    if let Err(e) = state.tus.delete(Headers::default(), uid).await {
        tracing::warn!("tus 暫存清不掉（id={}）：{e:?}", uid.as_str());
    }

    // 讓索引器把它撿進 files 表（跟 WebDAV 寫入走同一條路）
    let job = crate::utils::queue::JobType::IndexFile {
        path: relative.clone(),
    };
    if let Err(e) = state.queue.enqueue(job).await {
        tracing::warn!("tus 落地後的索引工作排不進去：{e}");
    }

    tracing::info!("tus 上傳落地：{relative}");
    Ok(())
}

/// 從 HEAD 回應的 `Upload-Metadata` 取出目的地相對路徑。
///
/// tus 的 metadata 是 `key base64value,key2 base64value2`。這裡認兩個鍵：
/// `filename`（必要）與 `path`（可選，父目錄）。
fn metadata_target(res: &Response) -> Option<String> {
    let raw = res.headers.get("upload-metadata")?.to_str().ok()?;
    let mut filename = None;
    let mut dir = String::new();

    for pair in raw.split(',') {
        let mut it = pair.trim().splitn(2, ' ');
        let key = it.next()?;
        let Some(value) = it.next() else { continue };
        let decoded = decode_base64(value)?;
        match key {
            "filename" => filename = Some(decoded),
            "path" => dir = decoded,
            _ => {}
        }
    }

    let name = filename?;
    if name.is_empty() {
        return None;
    }
    Some(if dir.is_empty() {
        name
    } else {
        format!("{}/{}", dir.trim_matches('/'), name)
    })
}

/// tus 的 metadata 值是標準 base64。
///
/// ⚠️ 自己解而不是拉一個 base64 crate：這裡只需要解碼，而且長度極短
/// （檔名）。多一個相依不值得。
fn decode_base64(s: &str) -> Option<String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        // position 的回傳值上限是 64（TABLE 的長度），轉 u32 不可能截斷
        let idx = u32::try_from(TABLE.iter().position(|&t| t == c)?).ok()?;
        buf = (buf << 6) | idx;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res_with(metadata: &str) -> Response {
        let mut r = Response::new(StatusCode::OK);
        r.headers
            .insert("upload-metadata", metadata.parse().expect("header"));
        r
    }

    #[test]
    fn decodes_plain_filename() {
        // "report.pdf"
        assert_eq!(
            metadata_target(&res_with("filename cmVwb3J0LnBkZg==")).as_deref(),
            Some("report.pdf")
        );
    }

    #[test]
    fn joins_path_and_filename() {
        // path=Documents, filename=report.pdf
        assert_eq!(
            metadata_target(&res_with("path RG9jdW1lbnRz,filename cmVwb3J0LnBkZg==")).as_deref(),
            Some("Documents/report.pdf")
        );
    }

    #[test]
    fn decodes_utf8_filenames() {
        // "報告.txt"
        assert_eq!(
            metadata_target(&res_with("filename 5aCx5ZGKLnR4dA==")).as_deref(),
            Some("報告.txt")
        );
    }

    #[test]
    fn rejects_missing_or_empty_filename() {
        assert!(metadata_target(&res_with("path RG9jcw==")).is_none());
        assert!(metadata_target(&res_with("filename ")).is_none());
    }

    #[test]
    fn is_complete_needs_both_headers() {
        let mut r = Response::new(StatusCode::NO_CONTENT);
        r.headers.insert("upload-offset", "10".parse().expect("h"));
        assert!(!is_complete(&r), "只有 offset 不能判定完成");
        r.headers.insert("upload-length", "20".parse().expect("h"));
        assert!(!is_complete(&r));
        r.headers.insert("upload-offset", "20".parse().expect("h"));
        assert!(is_complete(&r));
    }
}
