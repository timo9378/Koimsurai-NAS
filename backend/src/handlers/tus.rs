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

// ⚠️ 用單一變體的 enum 而不是 `String`，是為了讓 OpenAPI 產出
// `enum: ["1.0.0"]`。標成自由字串的話 schemathesis 會亂產版本號，
// 打出來幾乎全是 412 —— operation 看起來有被測到，實際一次都沒進到
// handler 本體。spec 要說出真正的約束，fuzz 才打得進去。
//
// ⚠️ 這裡用一般註解而不是 doc comment：utoipa 會把 doc comment 放進
// schema 的 description，而這段是寫給維護者的內部理由，不是給 API
// 使用者看的文件。
/// tus 協定版本。目前只有 1.0.0。
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub enum TusVersion {
    #[serde(rename = "1.0.0")]
    V1_0_0,
}

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

/// tus 的能力探索。
///
/// ⚠️ 這條掛在 CORS layer **之外**（見 routes/mod.rs）—— tower-http 的
/// `CorsLayer` 會短路掉每一個 OPTIONS，不管是不是真的 preflight。
#[utoipa::path(
    options,
    path = "/api/tus",
    tag = "tus",
    responses(
        // ⚠️ 是 200 不是 204。tus 規格說 SHOULD 回 204 或 200，而
        // tus-protocol 選了 200 —— 標註要照**實際行為**寫，不是照規格抄。
        // （schemathesis 的 status_code_conformance 抓到的。）
        (status = 200, description = "伺服器支援的 tus 版本與擴充（Tus-Version / Tus-Extension 標頭）")
    )
)]
pub async fn options(State(state): State<AppState>) -> AxumResponse {
    to_axum(state.tus.options())
}

/// 建立一份上傳（tus 的 creation 擴充）。
///
/// `Upload-Metadata` 帶目的地：`filename`（必要）與 `path`（可選的父目錄），
/// 兩者都是標準 base64。⚠️ 那是**客戶端說了算**的值，落地時一定要走
/// `StorageRoot::resolve`（見 [`finalize`]）。
#[utoipa::path(
    post,
    path = "/api/tus",
    tag = "tus",
    // ⚠️ 請求標頭一定要記進 spec。少了它們，schemathesis 不知道要送
    // Tus-Resumable，打出來幾乎全是 412 —— operation 看起來「有被測到」，
    // 實際上一次都沒進到 handler 本體。
    params(
        ("Tus-Resumable" = inline(TusVersion), Header, description = "協定版本，固定 1.0.0"),
        ("Upload-Length" = Option<i64>, Header, description = "檔案總位元組數。用 Upload-Defer-Length 時可省略"),
        ("Upload-Defer-Length" = Option<i64>, Header, description = "值為 1 表示長度稍後再給"),
        ("Upload-Metadata" = Option<String>, Header, description = "逗號分隔的 `鍵 base64值`；本服務認得 filename（必要）與 path")
    ),
    request_body(
        content = String,
        description = "可選的初始資料（creation-with-upload）。有 body 時 Content-Type 必須是 application/offset+octet-stream",
        content_type = "application/offset+octet-stream"
    ),
    responses(
        (status = 201, description = "已建立；Location 標頭是後續 PATCH 的目標"),
        (status = 412, description = "缺少或不支援的 Tus-Resumable"),
        (status = 413, description = "Upload-Length 超過上限"),
        (status = 415, description = "帶了 body 卻不是 application/offset+octet-stream")
    )
)]
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

/// 問這份上傳傳到哪了 —— 續傳的前提。
#[utoipa::path(
    head,
    path = "/api/tus/{id}",
    tag = "tus",
    params(
        ("id" = String, Path, description = "上傳 ID（建立時由 Location 標頭給出）"),
        ("Tus-Resumable" = inline(TusVersion), Header, description = "協定版本，固定 1.0.0")
    ),
    responses(
        (status = 200, description = "Upload-Offset / Upload-Length / Upload-Metadata 標頭"),
        (status = 404, description = "不存在或已過期")
    )
)]
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

/// 放棄一份上傳（tus 的 termination 擴充），連暫存一起清掉。
#[utoipa::path(
    delete,
    path = "/api/tus/{id}",
    tag = "tus",
    params(
        ("id" = String, Path, description = "上傳 ID"),
        ("Tus-Resumable" = inline(TusVersion), Header, description = "協定版本，固定 1.0.0")
    ),
    responses(
        (status = 204, description = "已刪除"),
        (status = 404, description = "不存在"),
        // tus 規定 OPTIONS 以外的每個請求都要帶 Tus-Resumable。
        // 這條原本漏標，schemathesis 直接打出來了。
        (status = 412, description = "缺少或不支援的 Tus-Resumable")
    )
)]
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

/// 續傳一段資料。
///
/// `Upload-Offset` 必須等於伺服器目前的 offset，否則回 **409** ——
/// 那不是可以忽略的錯誤：默默接受會讓檔案內容錯位而且沒有人發現。
///
/// 補完最後一塊時會觸發落地（搬進使用者的儲存空間），見 [`finalize`]。
#[utoipa::path(
    patch,
    path = "/api/tus/{id}",
    tag = "tus",
    params(
        ("id" = String, Path, description = "上傳 ID"),
        ("Tus-Resumable" = inline(TusVersion), Header, description = "協定版本，固定 1.0.0"),
        ("Upload-Offset" = i64, Header, description = "這一段從哪個位元組開始。必須等於伺服器目前的 offset，否則 409")
    ),
    request_body(content = String, description = "這一段的位元組", content_type = "application/offset+octet-stream"),
    responses(
        (status = 204, description = "已寫入；Upload-Offset 標頭是新的位置"),
        (status = 404, description = "不存在或已過期"),
        (status = 409, description = "Upload-Offset 與伺服器的狀態不符"),
        (status = 412, description = "缺少或不支援的 Tus-Resumable"),
        (status = 415, description = "Content-Type 不是 application/offset+octet-stream")
    )
)]
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

    // ⚠️ 先寫到**同一個目錄底下**的暫存檔，寫完才原子性 rename 過去。
    //
    // 原本是直接 `File::create(&dest)` 就地寫。那有兩個問題：
    //   1. `File::create` 是 truncate —— 從那一刻起 dest 就是壞的，而寫入
    //      途中失敗（磁碟滿、I/O 錯誤）就會把一個殘缺或 0 byte 的檔案留在
    //      使用者眼前，沒有任何提示。
    //   2. 舊的分塊上傳（`handlers/upload.rs`）一直都是寫 `.temp_uploads/`
    //      再 rename —— 兩條路徑對同一件事的保證不一樣，而 tus 是主要那條。
    //
    // 暫存檔要跟 dest 同一個目錄：跨檔案系統的 rename 不是原子的，也可能
    // 直接失敗（EXDEV）。
    // ⚠️ 檔名要以 `.` 開頭。索引器的 watcher 會跳過以點開頭的名字，而暫存檔
    // 如果是 `foo.bin.tus-xxx.partial` 這種可見名字，大檔案上傳時它會被索引
    // 進 files 表 —— 使用者在 Finder 裡就會看到一個奇怪的 `.partial` 項目。
    // （實測 160MB 的上傳就露出來了；6MB 因為複製在 debounce 的 500ms 內完成
    // 所以看不到 —— 也就是「小檔案測不出來」的那種 bug。）
    let temp = dest.with_file_name(format!(
        ".{}.tus-{}.partial",
        dest.file_name().unwrap_or_default().to_string_lossy(),
        uid.as_str()
    ));

    let write_result = async {
        let mut file = tokio::fs::File::create(&temp).await.map_err(AppError::from)?;
        let mut stream = download.body;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AppError::Status(StatusCode::INTERNAL_SERVER_ERROR))?;
            file.write_all(&chunk).await.map_err(AppError::from)?;
        }
        // ⚠️ 一定要 flush —— tokio 的 File 在 drop 時不保證資料已經寫出去，
        // 而且 drop 途中的寫入錯誤會被吞掉。本專案已經因為這件事踩過三次。
        file.flush().await.map_err(AppError::from)?;
        Ok::<(), AppError>(())
    }
    .await;

    if let Err(e) = write_result {
        // 失敗就把半成品收掉，dest 完全沒有被動過。
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(e);
    }

    // 資料完整地躺在暫存檔裡了，這時才動 dest。
    //
    // 覆寫既有檔案之前先存一份版本 —— `create_version` 是用 rename 把舊檔
    // **搬進** `.versions/`，所以這一步之後 dest 已經不存在，底下的 rename
    // 只是把新內容放到那個位置。
    if tokio::fs::try_exists(&dest).await.unwrap_or(false) {
        if let Err(e) = crate::utils::versioning::create_version(&dest, state.storage_path.as_path()).await {
            tracing::error!("覆寫前存版本失敗（{dest:?}）：{e:?}");
        }
    }

    if let Err(e) = tokio::fs::rename(&temp, &dest).await {
        let _ = tokio::fs::remove_file(&temp).await;
        return Err(AppError::from(e));
    }

    // 搬完就把 tus 的暫存清掉，否則同一份資料會佔兩份磁碟。
    if let Err(e) = state.tus.delete(Headers::default(), uid).await {
        tracing::warn!("tus 暫存清不掉（id={}）：{e:?}", uid.as_str());
    }

    // ⚠️ `files` 表要在這裡**同步**寫進去。
    //
    // 原本這裡只排了一個 `JobType::IndexFile`，旁邊還寫著「讓索引器把它撿進
    // files 表」—— 那句話是錯的：那個 job 打的是 `SearchService::index_file`
    // （tantivy 全文索引），跟 `Indexer::index_file`（`INSERT INTO files`）
    // 只是同名而已。也就是說 tus 落地之後，`GET /api/files` 要看得到這個
    // 檔案，唯一的途徑是 inotify watcher —— 500ms debounce，而且 flush 那段
    // 是在 `select!` 分支裡 await 的，flush 期間沒人在收 channel，量一大就會
    // 被 kernel 的 inotify queue 溢位吃掉，那時候檔案就**永遠**不會出現。
    //
    // 分塊上傳（`handlers/upload.rs`）一直都是自己 INSERT 的。tus 才是前端
    // 真正在走的那條路，卻反而是最終一致的 —— 使用者上傳完看不到自己的檔案。
    //
    // 借 `Indexer` 來寫是刻意的：hidden-file 跳過、mime 判定、parent_path
    // 正規化的規則跟 watcher 完全一樣，不要在這裡抄第二份。
    let indexer = crate::services::indexer::Indexer::new(
        state.pool.clone(),
        state.storage_path.as_path().to_path_buf(),
    );
    if let Err(e) = indexer.index_file(&dest).await {
        tracing::error!("tus 落地後寫 files 表失敗（{relative}）：{e:?}");
    }

    // 這個 job 負責的是全文搜尋的內容索引（tantivy），不是 files 表。
    let job = crate::utils::queue::JobType::IndexFile {
        path: relative.clone(),
    };
    if let Err(e) = state.queue.enqueue(job).await {
        tracing::warn!("tus 落地後的全文索引工作排不進去：{e}");
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
