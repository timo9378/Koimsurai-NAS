//! Rust struct → TypeScript 型別匯出器。
//!
//!     cargo run --bin export_types
//!
//! 產出 `packages/api-types/index.ts`，前端從 `@koimsurai/nas-api-types` 引用。
//! 在此之前前端是一份 225 行、靠人工跟 Rust 同步的 `src/types/api.ts`。
//!
//! 型別**不用在這裡列**：`specta::collect()` 會自動收集所有帶 `#[derive(specta::Type)]`
//! 的型別（要排除的話在該型別上加 `#[specta(collect = false)]`）。手工維護一份清單
//! 本身就是新的漂移來源 —— 漏加一個型別不會有任何症狀，只會在某天發現某個回應沒有型別。
//!
//! 這個 crate 的慣例是「跨 API 邊界的型別同時掛 `utoipa::ToSchema` 與 `specta::Type`」：
//! 前者餵 OpenAPI（給 schemathesis 做 fuzz），後者餵前端型別。新增 DTO 時兩個一起加。
//!
//! CI 會重跑這支並 `git diff --exit-code`：改了會進 API 的 struct 卻沒重新產生 TS，
//! drift gate 就會擋下來。

// 這支是 codegen CLI 不是 server：輸出對象是跑指令的人，不是結構化 log，
// 所以 println! 就是對的做法。全 workspace 的 print_stdout = deny 在這裡放行。
#![allow(clippy::print_stdout, reason = "codegen CLI，輸出對象是終端機不是 log")]

use specta_typescript::Typescript;
use std::path::PathBuf;

// 只是為了把 lib 連進來，讓 specta 的 collect ctor 有機會執行。
// 少了這行 collect() 會回傳空集合 —— 而且不會報錯，只會安靜地產出一個空檔案。
use Koimsurai_NAS as _;

const HEADER: &str = "\
// 由 `cargo run --bin export_types` 產生 —— 不要手改，改了下次重產就沒了。
// 對應的 Rust 定義在 backend/src/{models,handlers,services,utils}/。
";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let types = specta::collect();

    // 相對於 backend/ 往上一層，落在 monorepo 的 packages/ 底下。
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("packages/api-types/index.ts");

    Typescript::default()
        .header(HEADER)
        .export_to(&out, &types, specta_serde::Format)?;

    println!("已匯出型別 → {}", out.display());
    Ok(())
}
