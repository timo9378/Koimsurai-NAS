//! `OpenAPI` 標註與真實路由的一致性。
//!
//! ⚠️ 這個 repo 已經出現過**六次**「utoipa 的 `path = "…"` 跟 `.route("…")`
//! 對不上」：
//!
//! | 端點 | 標註寫的 | 真實路由 |
//! |---|---|---|
//! | `list_file_versions` | `/api/files/{path}/versions` | `/api/versions/file/{*path}` |
//! | `access_share_link`  | `/s/{id}`                    | `/api/share/{id}/download` |
//! | `upload_via_link`    | `/u/{id}`                    | `/api/upload-link/{id}/upload` |
//! | `add_tag`            | `/api/files/{path}/tags`     | `/api/tags/add/{*path}` |
//! | `remove_tag`         | `/api/files/{path}/tags/{tag_name}` | `/api/tags/remove/{tag_name}/{*path}` |
//! | `toggle_star`        | `/api/files/{path}/star`     | `/api/star/file/{*path}` |
//!
//! 症狀是**靜默的**：spec 裡多一條不存在的路徑，而真正的端點不在 spec 裡。
//! schemathesis 照 spec 產請求，所以那些端點**從來沒有被 fuzz 過** ——
//! 而其中 `upload_via_link` 不需要登入、收 multipart、會寫檔，
//! 今天在它身上找到的兩個洞都是人工看出來的。
//!
//! 這條測試讀原始碼比對兩邊。讀原始碼當測試很少見，但替代方案是繼續讓它
//! 靜默漂移 —— 而 axum 的 `Router` 不對外暴露路由表，`utoipa-axum` 的
//! `OpenApiRouter`（從構造上就同步）是另一個層級的改動。

use std::collections::HashSet;
use std::path::Path;

/// `{name}` 與 `{*name}` 都正規化成 `{}`，尾斜線去掉。
fn normalise(path: &str) -> String {
    let mut out = String::new();
    let mut chars = path.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            for inner in chars.by_ref() {
                if inner == '}' {
                    break;
                }
            }
            out.push_str("{}");
        } else if c == '*' {
            // `*path`（沒有大括號的萬用）
            while chars.peek().is_some_and(|n| n.is_alphanumeric() || *n == '_') {
                chars.next();
            }
            out.push_str("{}");
        } else {
            out.push(c);
        }
    }
    out.trim_end_matches('/').to_string()
}

fn rust_sources() -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    out.push(text);
                }
            }
        }
    }
    out
}

/// 所有 `.route("…")` 的路徑，含可能的 nest 前綴。
fn real_paths(sources: &[String]) -> HashSet<String> {
    let mut set = HashSet::new();
    for src in sources {
        for (idx, _) in src.match_indices(".route(") {
            let rest = &src[idx + ".route(".len()..];
            let Some(start) = rest.find('"') else { continue };
            let Some(end) = rest[start + 1..].find('"') else {
                continue;
            };
            let path = &rest[start + 1..start + 1 + end];
            for prefix in ["", "/api", "/api/auth", "/api/docker"] {
                set.insert(normalise(&format!("{prefix}{path}")));
            }
        }
    }
    set
}

/// 所有 `#[utoipa::path(… path = "…")]` 的路徑。
fn annotated_paths(sources: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for src in sources {
        for (idx, _) in src.match_indices("#[utoipa::path(") {
            let rest = &src[idx..];
            // 標註區塊到第一個 `)]` 為止就夠了
            let block = rest
                .get(..rest.find(")]").map_or(rest.len(), |e| e + 2))
                .unwrap_or(rest);
            let Some(p) = block.find("path = \"") else {
                continue;
            };
            let after = &block[p + "path = \"".len()..];
            let Some(end) = after.find('"') else { continue };
            out.push(after[..end].to_string());
        }
    }
    out
}

#[test]
fn every_openapi_path_matches_a_real_route() {
    let sources = rust_sources();
    let real = real_paths(&sources);
    let annotated = annotated_paths(&sources);

    assert!(
        annotated.len() > 50,
        "應該掃到大量標註，實際 {} 條 —— 掃描邏輯可能壞了",
        annotated.len()
    );

    let orphans: Vec<&String> = annotated
        .iter()
        .filter(|p| !real.contains(&normalise(p)))
        .collect();

    assert!(
        orphans.is_empty(),
        "這些 OpenAPI 標註指向不存在的路徑（spec 會發布一條 404，而真正的端點\n\
         不在 spec 裡、schemathesis 永遠不會 fuzz 它）：\n  {}",
        orphans
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n  ")
    );
}
