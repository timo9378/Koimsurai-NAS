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

// ── Basic 認證（標準 `WebDAV` 客戶端唯一會的那種）─────────────────────

/// 造一個 `Authorization: Basic` 標頭值。
fn basic(user: &str, pass: &str) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let raw = format!("{user}:{pass}");
    let b = raw.as_bytes();
    let mut out = String::from("Basic ");
    for c in b.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (c.get(1).map_or(0, |x| u32::from(*x)) << 8)
            | c.get(2).map_or(0, |x| u32::from(*x));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[tokio::test]
async fn a_standard_client_can_authenticate_with_basic() {
    let app = spawn_app().await;
    app.write_file("報告.txt", b"hello dav");
    // 只註冊，不用 cookie —— 標準客戶端沒有 cookie jar
    let _ = register_and_login(&app, "davclient").await;

    let res = Client::new()
        .get(dav(&app, "/報告.txt"))
        .header("Authorization", basic("davclient", "password123"))
        .send()
        .await
        .expect("get");
    assert_eq!(res.status(), StatusCode::OK, "Basic 認證應該通過");
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"hello dav");
}

#[tokio::test]
async fn wrong_basic_credentials_get_a_challenge() {
    let app = spawn_app().await;
    let _ = register_and_login(&app, "davwrong").await;

    for (user, pass) in [("davwrong", "not-the-password"), ("nobody", "password123")] {
        let res = Client::new()
            .get(dav(&app, "/"))
            .header("Authorization", basic(user, pass))
            .send()
            .await
            .expect("get");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{user} 不該通過");
        // ⚠️ 少了 WWW-Authenticate，客戶端不會跳出帳密輸入框 —— 使用者看到的
        // 是「連不上」而不是「請輸入密碼」。
        assert!(
            res.headers().contains_key("www-authenticate"),
            "401 要帶 WWW-Authenticate 客戶端才會提示輸入帳密"
        );
    }
}

/// 密碼裡有冒號也要能用。
///
/// ⚠️ RFC 7617：使用者名稱不能含冒號，**密碼可以**。用 `split(':')` 取兩段的
/// 實作會把那種密碼截斷，症狀是「這個帳號就是登不進 `WebDAV`」。
#[tokio::test]
async fn a_password_containing_a_colon_still_works() {
    let app = spawn_app().await;
    let client = Client::builder().cookie_store(true).build().expect("client");
    let password = "aa:bb:cc";

    let res = client
        .post(format!("{}/api/auth/register", app.address))
        .json(&serde_json::json!({
            "username": "colonuser",
            "password": password,
            "invite_code": common::TEST_INVITE_CODE,
        }))
        .send()
        .await
        .expect("register");
    assert!(res.status().is_success(), "註冊失敗：{}", res.status());

    app.write_file("c.txt", b"colon ok");
    let res = Client::new()
        .get(dav(&app, "/c.txt"))
        .header("Authorization", basic("colonuser", password))
        .send()
        .await
        .expect("get");
    assert_eq!(res.status(), StatusCode::OK, "含冒號的密碼應該也能用");
    assert_eq!(res.bytes().await.expect("body").as_ref(), b"colon ok");
}

/// 快取要真的省掉 argon2。
///
/// ⚠️ argon2 一次 verify 在開發機上實測 310ms。沒有快取的話，`WebDAV` 客戶端
/// 展開一層目錄（好幾個請求）光認證就要好幾秒，而且是個 `DoS` 放大器。
#[tokio::test]
async fn repeated_basic_requests_do_not_re_run_argon2() {
    let app = spawn_app().await;
    app.write_file("x.txt", b"x");
    let _ = register_and_login(&app, "davcache").await;
    let auth = basic("davcache", "password123");

    // 第一次會做 argon2
    let first = std::time::Instant::now();
    let res = Client::new()
        .get(dav(&app, "/x.txt"))
        .header("Authorization", auth.clone())
        .send()
        .await
        .expect("get");
    assert_eq!(res.status(), StatusCode::OK);
    let cold = first.elapsed();

    // 之後五次應該都走快取
    let warm_start = std::time::Instant::now();
    for _ in 0..5 {
        let res = Client::new()
            .get(dav(&app, "/x.txt"))
            .header("Authorization", auth.clone())
            .send()
            .await
            .expect("get");
        assert_eq!(res.status(), StatusCode::OK);
    }
    let warm_avg = warm_start.elapsed() / 5;

    assert!(
        warm_avg * 4 < cold,
        "快取後的請求應該明顯比第一次快（冷 {cold:?}、之後平均 {warm_avg:?}）—— \
         沒有明顯差距表示每個請求都還在做 argon2"
    );
}

/// 啟用 2FA 的帳號不能用 Basic 認證。
///
/// ⚠️ Basic 只有帳號密碼、沒有第二因素 —— 接受它等於替那些帳號開一道
/// 繞過 2FA 的後門。而使用者開 2FA 的理由正是「光有密碼不夠」。
///
/// 那些帳號要用 `WebDAV` 需要「應用程式專用密碼」，那是另一個功能。
///
/// ⚠️ 這條測試第一版是**假綠**的：我在開啟 2FA 之後故意送了一個錯的密碼
/// （多一個空格）想繞過憑證快取 —— 但錯的密碼本來就會 401，測試根本沒驗到
/// 2FA 這件事。正確的做法是用**沒有認證過的帳號**（所以沒有快取），
/// 而且送**正確**的密碼。
#[tokio::test]
async fn a_2fa_enabled_account_cannot_use_basic_auth() {
    let app = spawn_app().await;
    app.write_file("secret.txt", b"protected");

    // 兩個帳號、同樣的密碼，差別只在 2FA —— 對照組證明「被擋下」不是別的原因
    let _ = register_and_login(&app, "no_twofa").await;
    let _ = register_and_login(&app, "has_twofa").await;
    sqlx::query("UPDATE users SET totp_enabled = 1 WHERE username = ?")
        .bind("has_twofa")
        .execute(&app.pool)
        .await
        .expect("開啟 2FA");

    // ⚠️ 兩個帳號都還沒用 Basic 認證過，所以憑證快取是空的 ——
    // 這一步走的一定是真正的驗證路徑。
    let ok = Client::new()
        .get(dav(&app, "/secret.txt"))
        .header("Authorization", basic("no_twofa", "password123"))
        .send()
        .await
        .expect("get");
    assert_eq!(ok.status(), StatusCode::OK, "沒開 2FA 的帳號應該可以用 Basic");

    let blocked = Client::new()
        .get(dav(&app, "/secret.txt"))
        .header("Authorization", basic("has_twofa", "password123"))
        .send()
        .await
        .expect("get");
    assert_eq!(
        blocked.status(),
        StatusCode::UNAUTHORIZED,
        "開了 2FA 的帳號不該讓 Basic 過 —— 密碼正確也不行，那正是重點"
    );
}
