use std::path::Path;
use std::process::Command;
use tracing::{debug, error, warn};

/// 圖片大小限制 (50MB) - 超過此大小的圖片將使用 `FFmpeg` 處理
/// Image size limit (50MB) - Images larger than this will be processed with `FFmpeg`
const LARGE_IMAGE_THRESHOLD: u64 = 50 * 1024 * 1024;

/// 使用 `FFmpeg` 生成縮圖 (支援更多格式，包括 HEIC/HEIF，且不會 OOM)
/// Generate thumbnails using `FFmpeg` (supports more formats including HEIC/HEIF, won't OOM)
// 不是 async：內部只 spawn_blocking 丟出去（fire-and-forget），沒有任何 await。
// ⚠️ 仍需在 tokio runtime 內呼叫 —— spawn_blocking 要有 runtime context。
pub fn generate_thumbnails(file_path: std::path::PathBuf, storage_root: std::path::PathBuf) {
    tokio::task::spawn_blocking(move || {
        generate_thumbnails_sync(&file_path, &storage_root);
    });
}

/// Quick check based on file signature (magic bytes) to guess if a file is an image or video.
/// This is used to avoid running ffmpeg on non-media files (zip, txt, etc.).
pub fn is_likely_media(file_path: &std::path::Path) -> bool {
    use std::fs::File;
    use std::io::Read;

    let Ok(mut f) = File::open(file_path) else {
        return false;
    };

    let mut buf = [0u8; 16];
    let Ok(n) = f.read(&mut buf) else { return false };

    let s = &buf[..n];

    // PNG
    if s.starts_with(&[0x89, b'P', b'N', b'G']) {
        return true;
    }
    // JPEG
    if s.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return true;
    }
    // GIF
    if s.starts_with(b"GIF8") {
        return true;
    }
    // WebP (RIFF....WEBP)
    if n >= 12 && &s[0..4] == b"RIFF" && &s[8..12] == b"WEBP" {
        return true;
    }
    // MP4 / MOV (ftyp) - many boxes start with 4-byte size then 'ftyp'
    if n >= 8 && &s[4..8] == b"ftyp" {
        return true;
    }
    // MKV (EBML)
    if s.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return true;
    }
    // AVI (RIFF....AVI )
    if n >= 12 && &s[0..4] == b"RIFF" && &s[8..12] == b"AVI " {
        return true;
    }

    false
}

fn generate_thumbnails_sync(file_path: &std::path::Path, storage_root: &std::path::Path) {
    // 計算相對路徑
    let Ok(relative_path) = file_path.strip_prefix(storage_root) else {
        return;
    };

    let thumb_root = storage_root.join(".thumbnails");
    let thumb_dir = thumb_root.join(relative_path.parent().unwrap_or_else(|| Path::new("")));

    if let Err(e) = std::fs::create_dir_all(&thumb_dir) {
        error!("Failed to create thumbnail directory: {}", e);
        return;
    }

    let file_name = file_path.file_name().unwrap_or_default().to_string_lossy();

    // 檢查檔案大小來決定處理方式
    let file_size = std::fs::metadata(file_path).map_or(0, |m| m.len());

    if file_size > LARGE_IMAGE_THRESHOLD {
        warn!(
            "Large image detected ({}MB), using FFmpeg for safety",
            file_size / 1024 / 1024
        );
    }

    // 定義縮圖尺寸
    let sizes = [("small", 150), ("medium", 800), ("large", 1920)];

    for (size_name, max_dimension) in sizes {
        let output_path = thumb_dir.join(format!("{file_name}.{size_name}.jpg"));

        // 跳過已存在的縮圖
        if output_path.exists() {
            debug!("Thumbnail already exists: {:?}", output_path);
            continue;
        }

        // 使用 FFmpeg 生成縮圖
        // -vf scale: 保持比例縮放到指定的最大維度
        // -frames:v 1: 只輸出一幀 (對靜態圖片)
        // -q:v 2: JPEG 品質 (1-31, 較低=較好)
        let result = Command::new("ffmpeg")
            .arg("-i")
            .arg(file_path)
            .arg("-vf")
            .arg(format!(
                "scale='if(gt(iw,ih),{max_dimension},-2)':'if(gt(iw,ih),-2,{max_dimension})'"
            ))
            .arg("-frames:v")
            .arg("1")
            .arg("-q:v")
            .arg("2")
            .arg("-y") // 覆蓋已存在的檔案
            .arg(&output_path)
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    debug!("Generated {} thumbnail for {:?}", size_name, file_path);
                } else {
                    // FFmpeg 失敗時，嘗試使用 image crate 作為 fallback (僅對小檔案)
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    warn!("FFmpeg failed for {:?}: {}, trying fallback", file_path, stderr);

                    if file_size < LARGE_IMAGE_THRESHOLD {
                        generate_thumbnail_fallback(file_path, &output_path, max_dimension);
                    }
                }
            }
            Err(e) => {
                error!("Failed to execute FFmpeg: {}", e);
                // 嘗試 fallback
                if file_size < LARGE_IMAGE_THRESHOLD {
                    generate_thumbnail_fallback(file_path, &output_path, max_dimension);
                }
            }
        }
    }
}

/// Fallback: 使用 image crate 生成縮圖 (僅用於小檔案)
/// Fallback: Use image crate to generate thumbnails (only for small files)
fn generate_thumbnail_fallback(input_path: &Path, output_path: &Path, max_dimension: u32) {
    use image::ImageReader;

    let reader = match ImageReader::open(input_path) {
        Ok(r) => r,
        Err(e) => {
            error!("Failed to open image for fallback thumbnail: {}", e);
            return;
        }
    };

    match reader.decode() {
        Ok(img) => {
            let thumbnail = img.resize(
                max_dimension,
                max_dimension,
                image::imageops::FilterType::Lanczos3,
            );
            if let Err(e) = thumbnail.save(output_path) {
                error!("Failed to save fallback thumbnail: {}", e);
            } else {
                debug!("Generated fallback thumbnail: {:?}", output_path);
            }
        }
        Err(e) => {
            error!("Failed to decode image for fallback thumbnail: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// 寫一個檔案，回傳它的路徑。
    fn file_with(dir: &TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = dir.path().join(name);
        let mut f = std::fs::File::create(&p).expect("create");
        f.write_all(bytes).expect("write");
        p
    }

    /// ⚠️ 這支的判斷決定「要不要對這個檔案跑 ffmpeg」。
    ///
    /// 判太寬 = 對任意使用者上傳的內容執行 ffmpeg（那是一大片解析器攻擊面，
    /// 而且是以容器內的權限跑）；判太窄 = 縮圖安靜地不產生，使用者只會看到
    /// 一個永遠空白的格子，沒有任何錯誤訊息。兩個方向都要釘。
    #[test]
    fn recognises_the_formats_it_claims_to() {
        let dir = TempDir::new().expect("tempdir");
        let cases: [(&str, &[u8]); 7] = [
            ("a.png", &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            ("a.jpg", &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]),
            ("a.gif", b"GIF89a__________"),
            ("a.webp", b"RIFF____WEBPVP8 "),
            ("a.avi", b"RIFF____AVI LIST"),
            ("a.mp4", b"\0\0\0\x18ftypmp42________"),
            ("a.mkv", &[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]),
        ];
        for (name, bytes) in cases {
            assert!(
                is_likely_media(&file_with(&dir, name, bytes)),
                "{name} 的 magic bytes 應該被認出來"
            );
        }
    }

    #[test]
    fn rejects_things_that_are_not_images_or_video() {
        let dir = TempDir::new().expect("tempdir");
        let cases: [(&str, &[u8]); 6] = [
            ("a.zip", b"PK\x03\x04________"),
            ("a.txt", b"just some text__"),
            ("a.pdf", b"%PDF-1.7________"),
            ("a.gz", &[0x1F, 0x8B, 0x08, 0, 0, 0, 0, 0]),
            // ⚠️ WAV 也是 RIFF 開頭。只看前四個位元組的話會誤判成 WebP/AVI，
            //    然後對一個音訊檔跑縮圖。這條釘住「RIFF 之後還要看第 8-12 位元組」。
            ("a.wav", b"RIFF____WAVEfmt "),
            ("a.elf", &[0x7F, b'E', b'L', b'F', 0, 0, 0, 0]),
        ];
        for (name, bytes) in cases {
            assert!(
                !is_likely_media(&file_with(&dir, name, bytes)),
                "{name} 不該被當成媒體檔"
            );
        }
    }

    #[test]
    fn magic_bytes_beat_the_file_extension() {
        let dir = TempDir::new().expect("tempdir");
        // ⚠️ 判斷依據是 magic bytes 不是副檔名 —— 使用者改個副檔名就能決定
        //    要不要跑 ffmpeg 的話，那個檢查等於沒有。
        assert!(is_likely_media(&file_with(
            &dir,
            "假裝是文字.txt",
            b"\x89PNG\r\n\x1a\n____"
        )));
        assert!(!is_likely_media(&file_with(
            &dir,
            "假裝是圖片.png",
            b"not an image____"
        )));
    }

    #[test]
    fn short_empty_and_missing_files_do_not_panic() {
        let dir = TempDir::new().expect("tempdir");
        assert!(!is_likely_media(&file_with(&dir, "empty", b"")));
        assert!(!is_likely_media(&file_with(&dir, "two", b"\x89P")));
        // RIFF 但只有 4 個位元組 —— 第 8-12 的比對必須先檢查長度，否則會 panic
        assert!(!is_likely_media(&file_with(&dir, "riff-only", b"RIFF")));
        assert!(!is_likely_media(&dir.path().join("這個檔不存在")));
        assert!(!is_likely_media(dir.path()), "傳目錄進來也不該 panic");
    }

    #[test]
    fn a_file_outside_the_storage_root_is_ignored() {
        // ⚠️ 縮圖的輸出路徑是用 `file_path.strip_prefix(storage_root)` 算出來的。
        //    不在 storage 底下的話 strip_prefix 會失敗，函式必須直接返回 ——
        //    少了這個檢查，thumb_dir 會變成 `<storage>/.thumbnails` 加上一段
        //    無法預期的路徑。
        let storage = TempDir::new().expect("storage");
        let elsewhere = TempDir::new().expect("elsewhere");
        let outsider = file_with(&elsewhere, "x.png", b"\x89PNG\r\n\x1a\n____");

        generate_thumbnails_sync(&outsider, storage.path());

        assert!(
            !storage.path().join(".thumbnails").exists(),
            "不在 storage 底下的檔案不該產生任何東西"
        );
    }
}
