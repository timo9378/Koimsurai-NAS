//! 檔案中繼資料的解析（`utils/metadata.rs`）。導入覆蓋率時這支檔案是 **0%**。
//!
//! ⚠️ 為什麼值得測：`extract_metadata` 是在 **`list_files` 的請求 handler 裡
//! 逐檔呼叫**的（`handlers/file.rs`），而它把檔案交給三個解析函式庫
//! （`kamadak-exif`、`id3`、`mp4`）。那些函式庫吃的是**使用者上傳的位元組**。
//!
//! 任何一個在畸形輸入上 panic，壞掉的不是那一個檔案的中繼資料 ——
//! 是**整個目錄列不出來**。而使用者只會看到「資料夾打不開」。
//!
//! `metadata.rs` 自己的程式碼是乾淨的（7 處都處理了錯誤、0 個 unwrap），
//! 所以這裡驗的是函式庫在惡意輸入下的行為。

mod common;

use common::{register_and_login, spawn_app};
use reqwest::StatusCode;

/// 各種「副檔名說是媒體檔，內容不是」的位元組。
fn hostile_files() -> Vec<(&'static str, Vec<u8>)> {
    // 有 JPEG 的 SOI 與 EXIF APP1 標記，但長度欄位撒謊、資料被截斷
    let mut truncated_exif = vec![0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFE];
    truncated_exif.extend_from_slice(b"Exif\x00\x00");
    truncated_exif.extend_from_slice(&[0x49, 0x49, 0x2A, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]);

    // ID3v2 標頭宣稱一個巨大的 tag，後面什麼都沒有
    let mut lying_id3 = b"ID3\x04\x00\x00".to_vec();
    lying_id3.extend_from_slice(&[0x7F, 0x7F, 0x7F, 0x7F]);

    // MP4 的 ftyp box 宣稱的大小遠超過實際檔案
    let lying_mp4 = vec![
        0xFF, 0xFF, 0xFF, 0xFF, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm',
    ];

    vec![
        ("truncated-exif.jpg", truncated_exif),
        ("lying-id3.mp3", lying_id3),
        ("lying-box.mp4", lying_mp4),
        ("empty.jpg", Vec::new()),
        ("empty.mp4", Vec::new()),
        ("empty.mp3", Vec::new()),
        ("random.jpg", (0..512u16).map(|i| (i * 7 % 251) as u8).collect()),
        ("random.mp4", (0..512u16).map(|i| (i * 13 % 253) as u8).collect()),
        // 副檔名與內容完全對不上：JPEG 的標頭配 .mp4
        ("mismatched.mp4", vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]),
    ]
}

/// 用 API 上傳 —— **不能**直接寫磁碟。
///
/// ⚠️ `list_files` 讀的是 `files` 表而不是檔案系統。直接把檔案寫進儲存目錄
/// 的話它**不會出現在列表裡**（要等 file watcher 補上 DB 那一列），於是
/// `extract_metadata` 一次都不會被呼叫 —— 測試通過，但什麼也沒驗到。
///
/// 這條註解是實測換來的：第一版就是那樣寫的，列出來是空陣列。
async fn upload(app: &common::TestApp, client: &reqwest::Client, dir: &str, name: &str, bytes: Vec<u8>) {
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(bytes).file_name(name.to_string()),
    );
    let url = if dir.is_empty() {
        format!("{}/api/upload", app.address)
    } else {
        format!("{}/api/upload/{dir}", app.address)
    };
    let res = client
        .post(url)
        .header("Origin", app.origin_header())
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success(), "{name} 上傳失敗：{}", res.status());
}

/// 列出目錄並回傳檔名，順便斷言**真的有東西** —— 空列表代表這條測試沒驗到。
async fn list_names(app: &common::TestApp, client: &reqwest::Client, dir: &str) -> Vec<String> {
    let res = client
        .get(format!("{}/api/files/{dir}", app.address))
        .send()
        .await
        .expect("list");
    assert_eq!(res.status(), StatusCode::OK, "{dir} 列目錄失敗");
    let v: serde_json::Value = res.json().await.expect("json");
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|f| f["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// 畸形的媒體檔不該讓整個目錄列不出來。
#[tokio::test]
async fn malformed_media_does_not_break_the_listing() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "metadata").await;

    let files = hostile_files();
    for (name, bytes) in &files {
        upload(&app, &client, "hostile", name, bytes.clone()).await;
    }
    upload(&app, &client, "hostile", "normal.txt", b"fine".to_vec()).await;

    let names = list_names(&app, &client, "hostile").await;
    for (name, _) in &files {
        assert!(
            names.contains(&(*name).to_string()),
            "{name} 沒有出現在列表裡 —— extract_metadata 根本沒被呼叫，這條測試就沒驗到東西"
        );
    }
}

/// 單獨列每一個畸形檔案所在的目錄，才知道是**哪一個**炸的。
///
/// 上面那條把九個檔案放在一起，任何一個 panic 都會讓它紅但看不出是誰。
#[tokio::test]
async fn each_malformed_file_is_survivable_on_its_own() {
    let app = spawn_app().await;
    let client = register_and_login(&app, "metadata_one").await;

    for (name, bytes) in hostile_files() {
        let dir = name.replace('.', "_");
        upload(&app, &client, &dir, name, bytes).await;
        let names = list_names(&app, &client, &dir).await;
        assert!(names.contains(&name.to_string()), "{name} 沒被列出來，等於沒測到");
    }
}
