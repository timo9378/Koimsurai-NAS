//! 系統維護端點（`handlers/system.rs`）。導入覆蓋率時這支檔案是 **0%**。
//!
//! ⚠️ `/system/rescan` 與 `/system/verify-consistency` 會走訪**整棵儲存樹**，
//! 而且是在請求 handler 裡**同步**跑的。本專案的紀錄是 320k 個檔案掃一次
//! 超過 90 秒 —— `create_app` 刻意把初始掃描丟到背景就是因為
//! 「掃描期間整個站是掛的」。
//!
//! 而這兩個端點原本**完全沒有併發保護**，前端還在右鍵選單與 `TopBar` 兩個
//! 地方都放了 rescan 按鈕：使用者連點兩下、或兩個人同時按，就是兩個並行的
//! 全站掃描。

mod common;

use common::{register_and_login, spawn_app};
use reqwest::{Client, StatusCode};

#[tokio::test]
async fn maintenance_endpoints_require_login() {
    let app = spawn_app().await;
    for path in [
        "/api/system/status",
        "/api/system/rescan",
        "/api/system/verify-consistency",
    ] {
        let res = Client::new()
            .post(format!("{}{path}", app.address))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{path} 應該要登入");
    }
}

#[tokio::test]
async fn rescan_works_and_reports_success() {
    let app = spawn_app().await;
    app.write_file("a.txt", b"x");
    let client = register_and_login(&app, "rescanner").await;

    let res = client
        .post(format!("{}/api/system/rescan", app.address))
        .header("Origin", app.origin_header())
        .send()
        .await
        .expect("rescan");
    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value = res.json().await.expect("json");
    assert_eq!(body["success"], true, "掃描應該成功：{body}");
}

/// ⚠️ 兩個維護作業共用同一把鎖 —— 它們都在啃同一棵樹與同一個 DB，
/// 分開兩把鎖等於沒鎖。
#[tokio::test]
async fn a_second_maintenance_job_is_rejected_while_one_is_running() {
    let app = spawn_app().await;
    // 種一批檔案讓掃描慢到足以重疊
    for i in 0..400 {
        app.write_file(&format!("dir{}/f{i}.txt", i % 20), b"payload");
    }
    let client = register_and_login(&app, "double_click").await;

    let rescan = client
        .post(format!("{}/api/system/rescan", app.address))
        .header("Origin", app.origin_header())
        .send();
    let consistency = client
        .post(format!("{}/api/system/verify-consistency", app.address))
        .header("Origin", app.origin_header())
        .send();

    let (a, b) = tokio::join!(rescan, consistency);
    let mut codes = [a.expect("a").status(), b.expect("b").status()];
    codes.sort_by_key(reqwest::StatusCode::as_u16);

    // 一個做完、一個被拒 —— 不是排隊，排隊只是把 NAS 榨得更久
    assert_eq!(
        codes,
        [StatusCode::OK, StatusCode::CONFLICT],
        "同時打兩個維護作業，應該一個 200 一個 409，實際 {codes:?}"
    );
}

#[tokio::test]
async fn the_lock_is_released_after_the_job_finishes() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "sequential").await;

    for attempt in 1..=3 {
        let res = client
            .post(format!("{}/api/system/rescan", app.address))
            .header("Origin", app.origin_header())
            .send()
            .await
            .expect("rescan");
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "第 {attempt} 次應該還是可以跑（鎖要放掉）"
        );
    }
}
