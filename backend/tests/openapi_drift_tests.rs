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

use std::collections::{HashMap, HashSet};
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

/// 每個有 `#[utoipa::path]` 的 handler 都要被列進 `ApiDoc` 的 `paths(...)`。
///
/// ⚠️ 這是第**三**種漂移，而且最隱蔽：handler 標註了、路徑也對，但忘了加進
/// `#[derive(OpenApi)]` 的 `paths(...)` 清單 —— 於是它根本不在 spec 裡，
/// schemathesis 永遠不會碰它，而且**完全沒有症狀**：`/scalar` 少一個端點
/// 沒有人會注意到。
///
/// 實際規模：77 個標註裡有 25 個沒被列進去，包括
/// `upload_link::upload_via_link` —— 不需要登入、收 multipart、會寫檔的那個。
/// 修好它的路徑標註之後我一度以為「下次 fuzz 就會測到它」，其實不會。
#[test]
fn every_annotated_handler_is_listed_in_the_openapi_doc() {
    let routes_src =
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/routes/mod.rs"))
            .expect("讀 routes/mod.rs");

    // `paths(` 之後到對應 `),` 為止就是那份清單
    let start = routes_src.find("paths(").expect("找不到 paths(");
    let tail = &routes_src[start..];
    let end = tail.find("\n    ),").expect("找不到 paths 區塊的結尾");
    let listed: Vec<&str> = tail[..end]
        .lines()
        .filter_map(|l| l.trim().strip_suffix(','))
        .filter(|l| !l.starts_with("//"))
        .filter_map(|l| l.rsplit("::").next())
        .collect();

    assert!(
        listed.len() > 50,
        "應該掃到大量條目，實際 {} —— 掃描邏輯可能壞了",
        listed.len()
    );

    let mut missing = Vec::new();
    let mut stack = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/handlers")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let Ok(src) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (idx, _) in src.match_indices("#[utoipa::path(") {
                // 從標註往後找第一個 `pub async fn <name>`
                let rest = &src[idx..];
                let Some(fpos) = rest.find("pub async fn ") else {
                    continue;
                };
                let name: String = rest[fpos + "pub async fn ".len()..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() && !listed.contains(&name.as_str()) {
                    missing.push(format!("{}::{name}", path.file_stem().unwrap().to_string_lossy()));
                }
            }
        }
    }
    missing.sort();
    missing.dedup();

    assert!(
        missing.is_empty(),
        "這些 handler 有 #[utoipa::path] 標註但沒被列進 ApiDoc 的 paths(…)，\n\
         所以不在 spec 裡、schemathesis 永遠不會碰它們：\n  {}",
        missing.join("\n  ")
    );
}

/// `routes/mod.rs` 裡每條路由的**真實**路徑（含 nest 前綴）。
///
/// 為什麼要這麼麻煩：上面那兩條測試用的 `real_paths` 是**過近似**的 ——
/// 它把每條路由都配上四種可能的前綴各塞一份。那對「標註的路徑存不存在」
/// 夠用（寬鬆的一邊不會誤報），但反過來問「這條路由有沒有被標註」時，
/// 過近似會讓幾乎什麼都通過。
///
/// 前綴的來源有兩層，兩層都要走：
///   - `.nest("/api/auth", auth_routes)` —— 直接給前綴
///   - `.merge(two_factor_protected)` 寫在 `auth_routes` 裡面 —— 被併進去的
///     那個區塊繼承外層的前綴。少了這一層，`/2fa/status` 會被算成沒有前綴，
///     然後誤報成「沒有標註」。
fn routes_with_real_prefix() -> Vec<String> {
    let src = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("routes")
            .join("mod.rs"),
    )
    .expect("讀得到 routes/mod.rs");

    // 具名區塊的範圍：`let X = Router::new()` 到下一個頂層 `let ` 或最後的組裝。
    let mut blocks: Vec<(String, usize, usize)> = Vec::new();
    for (idx, _) in src.match_indices("\n    let ") {
        let after = idx + "\n    let ".len();
        let rest = &src[after..];
        let Some(eq) = rest.find(" = Router::new()") else {
            continue;
        };
        let name = rest[..eq].trim();
        if name.contains(' ') || name.is_empty() {
            continue;
        }
        let body_start = after + eq;
        let next_let = src[body_start..].find("\n    let ").map(|p| body_start + p);
        let assembly = src[body_start..]
            .find("\n    Router::new()")
            .map(|p| body_start + p);
        let end = match (next_let, assembly) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => src.len(),
        };
        blocks.push((name.to_string(), body_start, end));
    }

    // 第一層：`.nest("PFX", NAME)`
    let mut prefix: HashMap<String, String> = HashMap::new();
    for (idx, _) in src.match_indices(".nest(\"") {
        let rest = &src[idx + ".nest(\"".len()..];
        let Some(q) = rest.find('"') else { continue };
        let pfx = &rest[..q];
        let after = &rest[q + 1..];
        let Some(comma) = after.find(',') else { continue };
        let Some(close) = after.find(')') else { continue };
        if comma > close {
            continue;
        }
        let name = after[comma + 1..close].trim();
        if !name.is_empty() && !name.contains(' ') {
            prefix.insert(name.to_string(), pfx.to_string());
        }
    }

    // 第二層：某個區塊裡的 `.merge(NAME)` —— NAME 繼承該區塊的前綴。
    // 跑兩輪就夠了（這個檔案只有一層 merge），多跑無害。
    for _ in 0..2 {
        let mut inherited: Vec<(String, String)> = Vec::new();
        for (owner, bstart, bend) in &blocks {
            let outer = prefix.get(owner).cloned().unwrap_or_default();
            for (idx, _) in src[*bstart..*bend].match_indices(".merge(") {
                let rest = &src[*bstart + idx + ".merge(".len()..];
                let Some(close) = rest.find(')') else { continue };
                let name = rest[..close].trim();
                if !name.is_empty() && !name.contains(' ') && !name.contains('"') {
                    inherited.push((name.to_string(), outer.clone()));
                }
            }
        }
        for (name, pfx) in inherited {
            prefix.entry(name).or_insert(pfx);
        }
    }

    let mut out = Vec::new();
    for (idx, _) in src.match_indices(".route(") {
        let rest = &src[idx + ".route(".len()..];
        let Some(start) = rest.find('"') else { continue };
        let Some(end) = rest[start + 1..].find('"') else {
            continue;
        };
        let path = &rest[start + 1..start + 1 + end];
        // 路由路徑一定以 `/` 開頭；不是的話就是掃到了別的字串。
        if !path.starts_with('/') {
            continue;
        }

        let pfx = blocks
            .iter()
            .find(|(_, s, e)| idx > *s && idx < *e)
            .and_then(|(name, _, _)| prefix.get(name))
            .cloned()
            .unwrap_or_default();

        out.push(normalise(&format!("{pfx}{path}")));
    }
    out
}

/// 每條真實路由都要有 `#[utoipa::path]` 標註 —— 除非它在白名單上。
///
/// ⚠️ 這是第四種漂移，也是唯一一種**新增程式碼**就會犯的：加一條路由但
/// 忘了寫標註。前三種都是「改了一邊沒改另一邊」，至少還有一邊存在；
/// 這一種在 spec 裡完全沒有痕跡，`/scalar` 上看不出少了東西，
/// schemathesis 也永遠不會產生打它的請求。
///
/// 白名單是刻意的，每一條都要說得出為什麼不該進 spec。放行一條新的之前
/// 先問：它真的不是 REST API 嗎？
#[test]
fn every_real_route_has_an_openapi_annotation() {
    let sources = rust_sources();
    let annotated: HashSet<String> = annotated_paths(&sources).iter().map(|p| normalise(p)).collect();

    // 不是 REST API、或本來就不該出現在 OpenAPI 文件裡的東西。
    const ALLOWED: &[&str] = &[
        // WebSocket：升級協議，OpenAPI 3.0 描述不了。
        "/api/ws",
        // 前端錯誤回報的轉發端點（Sentry SDK tunnel）——
        // body 是 Sentry 的封包格式，不是這個 API 的資料模型。
        "/api/_report",
        // uptime 監控用的純文字探針，沒有資料模型。
        "/health",
        // SPA fallback 與靜態檔，回的是 HTML 不是 JSON。
        "/{}",
        "/",
    ];
    let allowed: HashSet<String> = ALLOWED.iter().map(|p| normalise(p)).collect();

    let missing: Vec<String> = routes_with_real_prefix()
        .into_iter()
        .filter(|p| !annotated.contains(p) && !allowed.contains(p))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    assert!(
        missing.is_empty(),
        "這些路由沒有 `#[utoipa::path]` 標註，所以完全不在 spec 裡，\
         schemathesis 永遠不會碰它們：\n  {}\n\
         要嘛補標註（並加進 `paths(...)`），要嘛加進這條測試的 ALLOWED \
         並寫清楚為什麼它不是 REST API。",
        missing.join("\n  ")
    );
}
