#![allow(clippy::print_stdout, reason = "codegen CLI，輸出對象是終端機不是 log")]
// 見 lib.rs 上方說明。
#![deny(clippy::unwrap_used)]

//! 把 `utoipa` 產生的 `OpenAPI` spec 寫成 JSON 檔。
//!
//! 存在的理由：`schemathesis` 需要一份 spec 才能對 API 做 fuzz，而
//! `/scalar` 那個端點現在在 `require_auth` 後面（見 `routes/mod.rs` 的說明）。
//! 從這裡取得的話 CI 不必先起伺服器、也不必偽造登入。
//!
//!     cargo run --bin export_openapi -- openapi.json

use utoipa::OpenApi;
use Koimsurai_NAS::routes::ApiDoc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "openapi.json".to_string());
    let spec = ApiDoc::openapi().to_pretty_json()?;
    std::fs::write(&out, spec)?;
    println!("已匯出 OpenAPI spec → {out}");
    Ok(())
}
