//! `WebDAV`（`handlers/webdav.rs`）。導入覆蓋率時這支檔案是 **0%**。
//!
//! ⚠️ 2026-08-31 的稽核發現這兩條路由掛在根 router 上、**不在任何 auth layer
//! 底下**，於是完全不需要憑證就能對整個儲存空間讀、寫、刪、列目錄。
//! 成因跟「`WebDAV` 對正常請求一律 404」是同一個：`DavHandler` 沒設
//! `strip_prefix`，dav-server 拿到的是 `/webdav/foo` 而不是 `/foo`，
//! 於是它服務的是 `<storage>/webdav/`，而 `..` 又爬得回儲存根。
//!
//! 這支檔案守的就是那兩件事。

mod common;

use common::{register_and_login, spawn_app, TestApp};
use reqwest::{Client, Method, StatusCode};

fn dav(app: &TestApp, path: &str) -> String {
    format!("{}/webdav{path}", app.address)
}

async fn anon(app: &TestApp, method: Method, path: &str, body: Option<&'static [u8]>) -> StatusCode {
    let mut req = Client::new().request(method, dav(app, path)).header("Depth", "1");
    if let Some(b) = body {
        req = req.body(b);
    }
    req.send().await.expect("request").status()
}

/// 每一個動詞都必須先登入。
///
/// ⚠️ 不要只測 GET —— 漏洞真正要命的是 PUT / DELETE / MKCOL，
/// 而它們走的是同一條路由、同一個 layer。少測一個就等於少守一個。
#[tokio::test]
async fn every_verb_requires_login() {
    let app = spawn_app().await;
    app.write_file("top-secret.txt", b"secret");

    let cases: [(Method, &str, Option<&'static [u8]>); 6] = [
        (Method::GET, "/top-secret.txt", None),
        (Method::from_bytes(b"PROPFIND").expect("m"), "/", None),
        (Method::PUT, "/written.txt", Some(b"owned")),
        (Method::DELETE, "/top-secret.txt", None),
        (Method::from_bytes(b"MKCOL").expect("m"), "/newdir", None),
        (Method::from_bytes(b"MOVE").expect("m"), "/top-secret.txt", None),
    ];

    for (method, path, body) in cases {
        let status = anon(&app, method.clone(), path, body).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} /webdav{path} 應該要 401"
        );
    }

    // 而且什麼都不該真的發生
    assert_eq!(
        std::fs::read(app.storage_dir.path().join("top-secret.txt")).expect("原檔還在"),
        b"secret"
    );
    assert!(
        !app.storage_dir.path().join("written.txt").exists(),
        "不該寫得進去"
    );
    assert!(!app.storage_dir.path().join("newdir").exists(), "不該建得出目錄");
}

/// `..` 不該讓未登入者摸到儲存根。
///
/// 修正之前 `GET /webdav/../top-secret.txt` 直接回 200 加內容。
#[tokio::test]
async fn parent_traversal_is_not_a_way_around_auth() {
    let app = spawn_app().await;
    app.write_file("top-secret.txt", b"secret");

    for path in [
        "/../top-secret.txt",
        "/%2e%2e/top-secret.txt",
        "/./../top-secret.txt",
    ] {
        let res = Client::new().get(dav(&app, path)).send().await.expect("request");
        let status = res.status();
        let body = res.bytes().await.expect("body");
        assert_ne!(
            body.as_ref(),
            b"secret",
            "{path} 把儲存根的檔案送出來了（狀態 {status}）"
        );
        assert_ne!(status, StatusCode::OK, "{path} 不該成功");
    }
}

/// 登入之後 `WebDAV` 要真的能用 —— 而且服務的是**儲存根**，不是
/// `<storage>/webdav/` 那個因為少了 `strip_prefix` 而生出來的子目錄。
#[tokio::test]
async fn an_authenticated_client_sees_the_storage_root() {
    let app = spawn_app().await;
    app.write_file("報告.txt", b"hello webdav");
    let client = register_and_login(&app, "dav_user").await;

    let res = client
        .get(dav(&app, "/報告.txt"))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("get");
    assert_eq!(res.status(), StatusCode::OK, "登入後應該讀得到儲存根的檔案");
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"hello webdav");

    // 少了 strip_prefix 的話這裡會是 404（它會去找 <storage>/webdav/報告.txt）
    assert!(
        !app.storage_dir.path().join("webdav").exists(),
        "不該憑空生出一個 <storage>/webdav 目錄 —— 那是 strip_prefix 沒設的徵兆"
    );
}
