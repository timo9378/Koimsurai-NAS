use std::path::{Path, PathBuf};

/// 在 `parent` 底下替 `desired` 找一個還沒被佔用的名字：
/// `a.txt` → `a (1).txt` → `a (2).txt`……
///
/// ⚠️ 為什麼複製一定要走這裡：`fs::copy(src, dst)` 在 `dst` 已存在時是
/// **直接覆寫**的。而「貼上到同一個資料夾」時 src 與 dst 會是同一個檔案 ——
/// Rust 的 `fs::copy` 會先以 truncate 開啟目的地，於是來源在被讀取前就已經
/// 被清空，結果是一個 0 byte 的檔案。也就是「複製」會把原檔毀掉。
///
/// 副檔名要保住：`a.txt` 的候選是 `a (1).txt`，不是 `a.txt (1)`。
/// 沒有副檔名（或以點開頭的隱藏檔）就整個名字當 stem。
///
/// 這是同步的 `exists()`，跟 `trash::restore_file` 原本那段一致 ——
/// 候選數量很少，而且中間有 TOCTOU 也只是退一步覆寫既有檔案的風險，
/// 不會比原本更糟。
pub fn available_path(parent: &Path, desired: &str) -> PathBuf {
    let candidate = parent.join(desired);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, ext) = split_name(desired);

    let mut counter = 1;
    loop {
        let candidate = parent.join(format!("{stem} ({counter}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// 切成 (stem, 含點的副檔名)。`.bashrc` 這種以點開頭的整個算 stem。
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(i) => (&name[..i], &name[i..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_extension_off() {
        assert_eq!(split_name("a.txt"), ("a", ".txt"));
        assert_eq!(split_name("a.tar.gz"), ("a.tar", ".gz"));
        assert_eq!(split_name("README"), ("README", ""));
        // 以點開頭的隱藏檔不該被切成 ("", ".bashrc")
        assert_eq!(split_name(".bashrc"), (".bashrc", ""));
    }

    #[test]
    fn no_collision_keeps_the_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(available_path(dir.path(), "a.txt"), dir.path().join("a.txt"));
    }

    #[test]
    fn collisions_count_up_and_keep_the_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("a.txt"), b"1").expect("write");
        assert_eq!(available_path(dir.path(), "a.txt"), dir.path().join("a (1).txt"));

        std::fs::write(dir.path().join("a (1).txt"), b"2").expect("write");
        assert_eq!(available_path(dir.path(), "a.txt"), dir.path().join("a (2).txt"));
    }

    #[test]
    fn works_for_names_without_an_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(dir.path().join("folder")).expect("mkdir");
        assert_eq!(
            available_path(dir.path(), "folder"),
            dir.path().join("folder (1)")
        );
    }
}
