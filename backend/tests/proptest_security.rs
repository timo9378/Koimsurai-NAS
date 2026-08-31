//! Property-based tests for security-critical functions
//!
//! Uses proptest to generate random/malicious inputs to stress test:
//! - Path validation
//! - Filename sanitization
//! - Other security boundaries

use proptest::prelude::*;

// 直接從專案的 utils 模組引入真實的函式
// 這樣可以確保我們測試的是實際使用的程式碼，而非測試檔內的複製品
// Note: Cargo package name uses underscore, so we use Koimsurai_NAS
use Koimsurai_NAS::utils::versioning::{sanitize_filename, validate_path};

proptest! {
    /// Test that validate_path never allows path traversal
    #[test]
    fn path_never_allows_traversal(s in ".*") {
        // If the path contains "..", it should be rejected
        if s.contains("..") {
            prop_assert!(!validate_path(&s), "Path with '..' should be rejected: {}", s);
        }
    }

    /// Test that validate_path rejects absolute paths
    #[test]
    fn path_rejects_absolute(s in "/.*") {
        prop_assert!(!validate_path(&s), "Absolute path should be rejected: {}", s);
    }

    /// Test that validate_path rejects null bytes
    #[test]
    fn path_rejects_null_bytes(
        prefix in "[a-zA-Z0-9_/]{0,20}",
        suffix in "[a-zA-Z0-9_/.]{0,20}"
    ) {
        let path = format!("{prefix}\0{suffix}");
        prop_assert!(!validate_path(&path), "Path with null byte should be rejected");
    }

    /// Test that validate_path rejects Windows paths
    #[test]
    fn path_rejects_windows_drive(
        drive in "[A-Z]",
        path in "[a-zA-Z0-9_/]{0,30}"
    ) {
        let win_path = format!("{drive}:\\{path}");
        prop_assert!(!validate_path(&win_path), "Windows path should be rejected: {}", win_path);
    }

    /// Test that sanitize_filename produces safe output
    #[test]
    fn sanitize_produces_safe_filename(s in ".*") {
        let sanitized = sanitize_filename(&s);

        // Should not contain dangerous characters
        prop_assert!(!sanitized.contains('/'), "Should not contain /");
        prop_assert!(!sanitized.contains('\\'), "Should not contain \\");
        prop_assert!(!sanitized.contains(':'), "Should not contain :");
        prop_assert!(!sanitized.contains('\0'), "Should not contain null");
        prop_assert!(!sanitized.contains('*'), "Should not contain *");
        prop_assert!(!sanitized.contains('?'), "Should not contain ?");
        prop_assert!(!sanitized.contains('"'), "Should not contain \"");
        prop_assert!(!sanitized.contains('<'), "Should not contain <");
        prop_assert!(!sanitized.contains('>'), "Should not contain >");
        prop_assert!(!sanitized.contains('|'), "Should not contain |");

        // Should not start with a dot (hidden file)
        prop_assert!(!sanitized.starts_with('.'), "Should not start with .");

        // Should never be empty
        prop_assert!(!sanitized.is_empty(), "Should not be empty");
    }

    /// Test with adversarial filename patterns
    #[test]
    fn sanitize_handles_adversarial_filenames(
        prefix in "[.]{0,5}",
        dangerous in prop::sample::select(vec![
            "/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\0",
            "../", "..\\", "/..", "\\..", "::$DATA"
        ]),
        suffix in "[a-zA-Z0-9]{0,10}"
    ) {
        let adversarial = format!("{prefix}{dangerous}{suffix}");
        let sanitized = sanitize_filename(&adversarial);

        // All dangerous patterns should be sanitized
        prop_assert!(!sanitized.contains(".."), "Should not contain ..: {}", sanitized);
        prop_assert!(!sanitized.contains('/'), "Should not contain /: {}", sanitized);
        prop_assert!(!sanitized.contains('\\'), "Should not contain \\: {}", sanitized);
    }

    /// Test that extremely long paths are handled
    #[test]
    fn handles_long_paths(s in "[a-zA-Z0-9_]{1,1000}") {
        // Should not panic
        let _ = validate_path(&s);
    }

    /// Test that extremely long filenames are handled
    #[test]
    fn handles_long_filenames(s in ".{1,1000}") {
        // Should not panic
        let _ = sanitize_filename(&s);
    }

    /// Test Unicode handling in paths
    #[test]
    fn handles_unicode_paths(s in "[\\p{L}\\p{N}_/]{1,100}") {
        // Unicode letters and numbers should generally be allowed
        // (unless they contain forbidden patterns)
        let result = validate_path(&s);
        // Just verify it doesn't panic
        let _ = result;
    }

    /// Test that valid paths are accepted
    #[test]
    fn accepts_valid_paths(
        segments in prop::collection::vec("[a-zA-Z0-9_-]{1,20}", 1..5)
    ) {
        let path = segments.join("/");
        prop_assert!(validate_path(&path), "Valid path should be accepted: {}", path);
    }
}

/// Additional targeted tests for edge cases
#[cfg(test)]
mod edge_cases {
    use super::*;

    #[test]
    fn test_unicode_normalization_attack() {
        // Some Unicode characters look like ".." but are different codepoints
        // U+FF0E is FULLWIDTH FULL STOP
        let sneaky_path = "folder/\u{FF0E}\u{FF0E}/etc/passwd";
        // This should be caught or the path should be normalized first
        // For now, just ensure it doesn't panic
        let _ = validate_path(sneaky_path);
    }

    #[test]
    fn test_url_encoded_traversal() {
        // %2e%2e%2f = ../
        // This test assumes the input has already been URL decoded
        // If your web framework doesn't auto-decode, you need to handle this
        let encoded = "%2e%2e%2fpasswd";
        // After decoding this would be "../passwd"
        // The raw encoded form might pass validation
        let _ = validate_path(encoded);
    }

    #[test]
    fn test_double_url_encoding() {
        // %252e%252e%252f = %2e%2e%2f (after one decode) = ../ (after second decode)
        let double_encoded = "%252e%252e%252f";
        let _ = validate_path(double_encoded);
    }

    #[test]
    fn test_ntfs_alternate_data_streams() {
        // Windows NTFS alternate data streams
        let ads = "file.txt:$DATA";
        let sanitized = sanitize_filename(ads);
        assert!(!sanitized.contains(':'), "Should remove NTFS ADS marker");
    }

    #[test]
    fn test_windows_reserved_names() {
        // Windows reserved device names
        let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"];
        for name in reserved {
            let sanitized = sanitize_filename(name);
            // Should at least not panic
            assert!(!sanitized.is_empty());
        }
    }

    #[test]
    fn test_path_with_only_dots() {
        assert!(!validate_path("."));
        assert!(!validate_path(".."));
        assert!(!validate_path("..."));
        assert!(!validate_path("folder/.")); // Current dir reference should be rejected
        assert!(!validate_path("./folder")); // Starting with current dir should be rejected
    }
}

// ═══════════════ 這輪修過的路徑／位移邏輯（2026-08-31）═══════════════
//
// ⚠️ 這一批的存在理由：這輪的九個安全問題裡有五個是路徑處理，而它們的共同
// 特徵是「只有特定形狀的輸入才會破」——`/data/storage-backup`（同前綴）、
// `../../secret`（元件前綴通過但解析後跑出去）、`\0`（要碰檔案系統才炸）。
// 定樁測試只能蓋到想得到的那幾種，性質測試才問得出「任何輸入下都成立嗎」。

use std::path::{Path, PathBuf};
use Koimsurai_NAS::storage::validate_path as validate_under;

proptest! {
    /// `validate_path(base, x)` 只要回 Ok，結果就一定在 base 底下。
    ///
    /// ⚠️ 這是整個檔案存取層的核心不變式。這輪 HLS 的任意檔案讀取就是因為
    /// 另一處用了**字面**的 `Path::starts_with`（不解析 `..`）而破掉的。
    #[test]
    fn validated_paths_never_escape_the_base(
        segments in prop::collection::vec("[^/\\\\\0]{0,8}|\\.\\.|\\.", 0..6)
    ) {
        let base = PathBuf::from("/srv/storage");
        let user_path = segments.join("/");

        if let Ok(resolved) = validate_under(&base, &user_path) {
            // 元件層級比對（不是字元前綴）——`/srv/storage-backup` 必須不算數
            prop_assert!(
                resolved.starts_with(&base),
                "{user_path:?} 解析成 {resolved:?}，跑出 base 之外了"
            );
            // 而且結果裡不能殘留 `..`：留著的話 OS 會在開檔時才解析，
            // 那時已經沒有人在檢查了
            prop_assert!(
                !resolved.components().any(|c| matches!(c, std::path::Component::ParentDir)),
                "{user_path:?} 的結果裡還有 ParentDir：{resolved:?}"
            );
        }
    }

    /// 任何含 NUL 的路徑一律拒絕。
    ///
    /// ⚠️ Rust 的 `Path` 容得下 NUL，是轉成 C 字串時才失敗——原本那一步的
    /// io::Error 被往上丟成 500 並把 OS 訊息送給客戶端。
    #[test]
    fn nul_bytes_are_always_rejected(prefix in "[a-z/]{0,10}", suffix in "[a-z/]{0,10}") {
        let base = PathBuf::from("/srv/storage");
        let with_nul = format!("{prefix}\0{suffix}");
        prop_assert!(
            validate_under(&base, &with_nul).is_err(),
            "含 NUL 的路徑必須被拒絕：{with_nul:?}"
        );
    }

    /// 不含 `..`、`.`、NUL 的相對路徑一定通得過，而且結果就是 base 接上去。
    ///
    /// ⚠️ 反方向也要測：只驗「該擋的擋住」的話，「全部都擋」也會全綠——
    /// 而那會讓整個檔案管理功能壞掉。
    #[test]
    fn ordinary_relative_paths_always_pass(
        segments in prop::collection::vec("[a-zA-Z0-9\u{4e00}-\u{9fff}]{1,8}", 1..5)
    ) {
        let base = PathBuf::from("/srv/storage");
        let user_path = segments.join("/");
        let resolved = validate_under(&base, &user_path).expect("一般相對路徑不該被擋");
        prop_assert_eq!(resolved, base.join(Path::new(&user_path)));
    }

    /// 開頭的 `/` 被視為 storage 根，不是宿主機的根。
    ///
    /// ⚠️ 這個語意刻意如此（使用者眼中的 `/etc` 是 NAS 的根目錄底下）。
    /// 有人「順手把絕對路徑一律拒絕」會壞掉一半的前端呼叫。
    #[test]
    fn a_leading_slash_means_the_storage_root(
        segments in prop::collection::vec("[a-zA-Z0-9]{1,8}", 1..4)
    ) {
        let base = PathBuf::from("/srv/storage");
        let relative = segments.join("/");
        let absolute = format!("/{relative}");
        prop_assert_eq!(
            validate_under(&base, &absolute).ok(),
            validate_under(&base, &relative).ok()
        );
    }
}
