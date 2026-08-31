//! 儲存根目錄的「能力」型別。
//!
//! # 為什麼需要這個
//!
//! 這包後端修過五個路徑逃逸漏洞，沒有一個是 [`validate_path`] 寫錯 ——
//! 全部都是 handler **根本沒呼叫它**，直接 `storage_path.join(使用者輸入)`。
//! 兩種寫法的型別完全一樣（都是 `PathBuf`），所以 review 看不出差別：
//!
//! ```ignore
//! let p = validate_path(&state.storage_path, &user)?;   // 對
//! let p = state.storage_path.join(&user);               // 錯，長得一模一樣
//! ```
//!
//! `batch_copy` 甚至就緊接在**有**驗證的 `batch_move` 下面，還是漏了。
//!
//! # 做法
//!
//! [`StorageRoot`] 把根路徑收成私有欄位，不實作 `Deref`／`AsRef<Path>`，
//! 也沒有 `join`。要拿到根底下的路徑只有 [`resolve`](StorageRoot::resolve)
//! 一條路，而它會驗證。於是「忘記驗證」不再是一個寫得出來的錯誤 ——
//! 那行編譯不過。
//!
//! 這就是 `cap-std` 的核心想法（拿不到 ambient 的根，只有一個能力物件）。
//! 之所以不直接用 `cap-std`：它只有同步 API，`cap-tokio` 是 `0.0.0` 空殼，
//! 而這包有 40 處 `tokio::fs`，全包進 `spawn_blocking` 的風險遠大於收益。
//!
//! # 已知的邊界
//!
//! [`as_path`](StorageRoot::as_path) 仍然開了一個口（拿到 `&Path` 就能
//! `join`）。它是給 `WalkDir`／`WebDAV`／`strip_prefix` 這類需要根本身的地方用
//! 的，全專案的呼叫點可以 grep 出來且都不吃使用者輸入。差別在於逃逸從
//! 「預設行為」變成「要顯式寫出來的動作」。

use std::path::{Component, Path, PathBuf};

use axum::http::StatusCode;

use crate::error::AppError;

/// 把使用者給的相對路徑接到 `base` 底下，逐個 component 檢查。
///
/// 通過表示：結果一定在 `base` 底下，且不含 `..`。
/// 這是純函式，property test 直接打它（`tests/proptest_security.rs`）。
pub fn validate_path(base: &Path, user_path: &str) -> Result<PathBuf, AppError> {
    // ⚠️ NUL byte 要在這裡就擋掉。
    //
    // Rust 的 `Path` 本身容得下 NUL，但真正要碰檔案系統時得轉成 C 字串，
    // 那一步會失敗並回一個 io::Error。原本的處置是往上丟成 500：
    //
    //     POST /api/files/batch/move  destination="\0..."
    //       → 500 {"error":"file name contained an unexpected NUL byte"}
    //
    // 狀態碼是錯的（客戶端送的東西造成的），而且把 OS 的錯誤字串送出去。
    // 擋在這裡等於一次涵蓋所有吃路徑的端點。（schemathesis 找到的。）
    if user_path.contains('\0') {
        return Err(AppError::Status(StatusCode::BAD_REQUEST));
    }

    let path = Path::new(user_path);
    let mut full_path = base.to_path_buf();

    // 逐層檢查路徑組件，防止 ".." 回到上一層
    for component in path.components() {
        match component {
            Component::Normal(c) => full_path.push(c),
            Component::RootDir => {}                                  // 忽略開頭的 /
            _ => return Err(AppError::Status(StatusCode::FORBIDDEN)), // 遇到 .. 或其他特殊字元直接拒絕
        }
    }

    // 雙重保險：檢查最終路徑是否真的在 storage 底下 (防止符號連結攻擊)
    // 注意：這步只對「已存在」的檔案有效，上傳時要視情況調整
    if full_path.exists() {
        if let Ok(canonical_path) = full_path.canonicalize() {
            if let Ok(canonical_base) = base.canonicalize() {
                if !canonical_path.starts_with(canonical_base) {
                    return Err(AppError::Status(StatusCode::FORBIDDEN));
                }
            }
        }
    }

    Ok(full_path)
}

/// 儲存根目錄。持有它才碰得到底下的檔案，而且只能透過會驗證的方法。
#[derive(Clone, Debug)]
pub struct StorageRoot {
    // 私有 —— 這是整個型別存在的理由。加上 pub 或 Deref 就等於把保證還回去了。
    base: PathBuf,
}

impl StorageRoot {
    #[must_use]
    pub const fn new(base: PathBuf) -> Self {
        Self { base }
    }

    /// 給背景 worker 用 —— 它沒有 `AppState`，自己從環境變數重建。
    #[must_use]
    pub fn from_env() -> Self {
        Self::new(PathBuf::from(
            std::env::var("STORAGE_PATH").unwrap_or_else(|_| "storage".to_string()),
        ))
    }

    /// 使用者給的相對路徑 → 根底下的絕對路徑。**唯一**的正規入口。
    ///
    /// # Errors
    /// 含 `..`、NUL，或 canonicalize 後跑到根之外時回 403／400。
    pub fn resolve(&self, user_path: &str) -> Result<PathBuf, AppError> {
        validate_path(&self.base, user_path)
    }

    /// 內部目錄（`.trash` 之類）底下、由使用者指定的一段。
    ///
    /// `dir` 限定 `&'static str`，所以放不進使用者輸入 —— 想繞過得先
    /// 顯式 leak 一個字串，那不會是手滑寫出來的。
    ///
    /// # Errors
    /// 同 [`resolve`](Self::resolve)；`user_path` 想用 `..` 爬出 `dir` 也會被擋。
    pub fn resolve_under(&self, dir: &'static str, user_path: &str) -> Result<PathBuf, AppError> {
        self.resolve(&format!("{dir}/{user_path}"))
    }

    /// 純字面常數的內部目錄，例如 `.hls_cache`。不接受使用者輸入。
    #[must_use]
    pub fn internal(&self, literal: &'static str) -> PathBuf {
        self.base.join(literal)
    }

    /// 把根底下的絕對路徑轉回相對路徑（存 DB／回傳給前端用）。
    #[must_use]
    pub fn relativize<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        path.strip_prefix(&self.base).ok()
    }

    /// 逃生口：拿根路徑本身。給 `WalkDir`／`WebDAV`／受限 shell 的 base 用。
    ///
    /// ⚠️ 拿到 `&Path` 就能 `join` —— 只有在**不涉及使用者輸入**時才該用它。
    /// 需要接使用者路徑請用 [`resolve`](Self::resolve)。
    #[must_use]
    pub fn as_path(&self) -> &Path {
        &self.base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> (tempfile::TempDir, StorageRoot) {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let root = StorageRoot::new(dir.path().to_path_buf());
        (dir, root)
    }

    #[test]
    fn resolve_keeps_paths_under_the_root() {
        let (dir, root) = root();
        let p = root.resolve("a/b/c.txt").expect("普通相對路徑要過");
        assert!(p.starts_with(dir.path()));
    }

    #[test]
    fn resolve_rejects_parent_dir() {
        let (_dir, root) = root();
        assert!(root.resolve("../escape").is_err());
        assert!(root.resolve("a/../../escape").is_err());
    }

    #[test]
    fn resolve_treats_leading_slash_as_the_root() {
        let (dir, root) = root();
        assert_eq!(root.resolve("/a.txt").expect("要過"), dir.path().join("a.txt"));
    }

    #[test]
    fn resolve_under_cannot_climb_out_of_its_directory() {
        let (dir, root) = root();
        assert_eq!(
            root.resolve_under(".trash", "x.txt").expect("要過"),
            dir.path().join(".trash").join("x.txt")
        );
        // axum 的 Path 抽取器會把 %2F 解碼，所以這確實進得來
        assert!(root.resolve_under(".trash", "../../etc/passwd").is_err());
    }

    #[test]
    fn relativize_round_trips_with_resolve() {
        let (_dir, root) = root();
        let full = root.resolve("docs/報告.txt").expect("要過");
        assert_eq!(
            root.relativize(&full).expect("在根底下"),
            Path::new("docs/報告.txt")
        );
    }
}
