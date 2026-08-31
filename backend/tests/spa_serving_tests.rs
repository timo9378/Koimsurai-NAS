//! Production 的靜態檔供應（`attach_spa`）。
//!
//! 為什麼要釘：這條路徑只在 production 生效（dev 由 Vite 供應、測試預設沒有
//! 靜態目錄），所以壞掉不會有人在開發時發現 —— 只會在部署之後變成「白畫面」
//! 或「打錯 API 卻拿到一份 HTML」。

mod common;

use common::{spawn_app, spawn_app_with_static};
use reqwest::{redirect::Policy, Client};

fn client() -> Client {
    Client::builder()
        .redirect(Policy::none())
        .build()
        .expect("build client")
}

#[tokio::test]
async fn deep_routes_fall_back_to_index_html() {
    let app = spawn_app_with_static().await;
    let c = client();

    for path in ["/", "/login", "/s/abc123", "/u/xyz"] {
        let res = c
            .get(format!("{}{path}", app.address))
            .send()
            .await
            .expect("request");
        assert!(
            res.status().is_success(),
            "{path} 應為 2xx，實際 {}",
            res.status()
        );
        let body = res.text().await.expect("body");
        assert!(
            body.contains("<!doctype html>") || body.contains("<!DOCTYPE html>"),
            "{path} 應該回 index.html，實際: {}",
            &body[..body.len().min(80)]
        );
    }
}

#[tokio::test]
async fn unmatched_api_paths_return_404_not_html() {
    let app = spawn_app_with_static().await;
    let c = client();

    // ⚠️ 這是這支測試最重要的一條。少了 attach_spa 裡的路徑判斷，未命中的
    // /api/* 會落進 SPA fallback 拿到 200 + HTML，前端就會在 JSON.parse 掛掉
    // —— 那個症狀比一個乾淨的 404 難查十倍。
    for path in ["/api/definitely-not-a-route", "/api/files/../etc", "/webdav-nope"] {
        let res = c
            .get(format!("{}{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status().as_u16(), 404, "{path} 應為 404");
        let body = res.text().await.expect("body");
        assert!(
            !body.contains("<html") && !body.contains("<!doctype"),
            "{path} 不該回 HTML，實際: {}",
            &body[..body.len().min(80)]
        );
    }
}

#[tokio::test]
async fn hashed_assets_are_immutably_cacheable() {
    let app = spawn_app_with_static().await;
    let c = client();

    let res = c
        .get(format!("{}/assets/app-abc123.js", app.address))
        .send()
        .await
        .expect("request");
    assert!(res.status().is_success());
    let cc = res
        .headers()
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        cc.contains("immutable"),
        "帶 hash 的資產應可永久快取，實際 Cache-Control: {cc:?}"
    );

    // index.html 是入口，必須每次重新確認 —— 給它 immutable 等於部署完看不到新版
    let res = c.get(format!("{}/", app.address)).send().await.expect("request");
    let cc = res
        .headers()
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        !cc.contains("immutable"),
        "index.html 不該 immutable，實際: {cc:?}"
    );
}

#[tokio::test]
async fn missing_assets_return_404_not_index_html() {
    let app = spawn_app_with_static().await;
    let c = client();

    // ⚠️ /assets/ 底下放的是帶 content hash 的產物。部署後若有陳舊的 index.html
    // 指向舊 hash，回 index.html 會讓瀏覽器把 HTML 當 JS 執行，得到
    // `Uncaught SyntaxError: Unexpected token '<'` —— 一個看不出成因的錯。
    // 回 404 才指得出「那個資產不見了」。
    for path in ["/assets/app-STALEHASH.js", "/assets/app-abc123.js.map"] {
        let res = c
            .get(format!("{}{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status().as_u16(), 404, "{path} 應為 404");
        let body = res.text().await.expect("body");
        assert!(
            !body.contains("<!doctype") && !body.contains("<html"),
            "{path} 不該回 HTML"
        );
    }
}

/// ⚠️ 這條**刻意用 `spawn_app`（沒有 STATIC_DIR）**。
///
/// 沒有 SPA fallback 時，未知的 `/api/*` 要回 404 而不是 401。
/// 接 tus 時用 `.layer()` 而不是 `.route_layer()` 把 require_auth 掛到一個
/// merge 進根層的 router 上，middleware 連 fallback 一起包住，所有未知的
/// `/api/*` 就從 404 變成 401。
///
/// 那個回歸在有 STATIC_DIR 時看不見（會先被 SPA fallback 接走），所以
/// E2E 全綠 —— 是 api-fuzz 的 readiness 探測等了 60 秒失敗才暴露出來。
#[tokio::test]
async fn unmatched_api_paths_are_404_even_without_a_spa() {
    let app = spawn_app().await;
    let res = reqwest::get(format!("{}/api/definitely-not-a-route", app.address))
        .await
        .expect("request");
    assert_eq!(
        res.status(),
        reqwest::StatusCode::NOT_FOUND,
        "未知的 API 路徑要回 404；401 表示有 middleware 連 fallback 一起包住了"
    );
}
