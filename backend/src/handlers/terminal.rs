use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::Deserialize;
// write! 寫進 String 需要這個 trait 在 scope（format_push_string 的建議寫法）
use std::collections::HashSet;
use std::fmt::Write;

use crate::state::AppState;

/// 受限終端機 - 只允許安全的基本命令
/// 這是一個模擬的 shell 環境，不會直接執行系統命令

#[derive(Debug, Deserialize)]
pub struct TerminalQuery {
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

const fn default_cols() -> u16 {
    80
}
const fn default_rows() -> u16 {
    24
}

/// 允許的命令白名單 - 只包含容器內實際可用的命令
fn get_allowed_commands() -> HashSet<&'static str> {
    [
        // 內建命令
        "help", "clear", "exit", "logout", "history", // 檔案操作 (coreutils - 容器內有)
        "ls", "ll", "la", "pwd", "cd", "cat", "head", "tail", "echo", "mkdir", "touch", "cp", "mv", "rm",
        "ln", "chmod", "chgrp", "stat", "file", "basename", "dirname", "realpath", "readlink",
        // 文字處理
        //
        // ⚠️ awk 與 sed **刻意不在名單上**（xargs 同理，見 check_process_spawning）。
        // 兩者都能執行外部命令（awk 的 system()、GNU sed 的 e 命令）或寫入任意
        // 路徑（sed 的 w），而這一層擋不住：is_command_safe 拿到的是**未經 shell
        // 拆解**的字串，用 split_whitespace 切，引號裡的腳本本體根本切不開。
        // 想擋就只能字串比對，而 `system ("id")` 多一個空格就繞過去了——
        // 那種檢查看起來像防護，其實不是，比沒有更糟。
        //
        // 需要它們的話有兩條路：把命令解析改成 quote-aware（shlex 之類），
        // 或改用容器層級的隔離（seccomp／唯讀 rootfs）而不是命令白名單。
        "grep", "find", "wc", "sort", "uniq", "cut", "tr", "tee", "diff",
        // 系統資訊 (procps - 已安裝)
        "ps", "top", "free", "uptime", "w", "kill", "pgrep", "pkill", // 磁碟工具
        "df", "du",
        // 壓縮工具 (需要額外安裝，暫時移除)
        // "tar", "gzip", "gunzip", "zip", "unzip",
        // 其他
        "date", "whoami", "hostname", "uname", "env", "printenv", "which", "type", "true", "false", "test",
        "expr", // FFmpeg (已安裝)
        "ffmpeg", "ffprobe",
    ]
    .into_iter()
    .collect()
}

/// 獲取命令列表供 Tab 補全使用
pub fn get_available_commands() -> Vec<&'static str> {
    vec![
        "help", "clear", "exit", "logout", "history", "ls", "ll", "la", "pwd", "cd", "cat", "head", "tail",
        "echo", "mkdir", "touch", "cp", "mv", "rm", "ln", "chmod", "stat", "file", "basename", "dirname",
        "grep", "find", "wc", "sort", "uniq", "cut", "tr", "tee", "diff", "ps", "top", "free", "uptime", "w",
        "kill", "df", "du", "date", "whoami", "hostname", "uname", "env", "which", "ffmpeg", "ffprobe",
    ]
}

/// 危險的 shell 元字符 — 禁止出現在任何地方
/// 這些字符可用來繞過白名單（命令替換、進程替換等）
const fn get_dangerous_shell_chars() -> &'static [&'static str] {
    &[
        "`",   // backtick 命令替換
        "$(",  // $() 命令替換
        "$((", // 算術展開
        "${",  // 變數展開
        "<(",  // 進程替換
        ">(", ">>", // append redirect
        "<<", // here-doc
        "\\", // 反斜線轉義
        "\n", // newline (命令分隔)
        "\r",
    ]
}

/// 危險命令黑名單 — 絕對禁止的命令名稱
fn get_dangerous_commands() -> HashSet<&'static str> {
    [
        "sudo",
        "su",
        "chown",
        "chroot",
        "mount",
        "umount",
        "mkfs",
        "dd",
        "eval",
        "exec",
        "source",
        "curl",
        "wget",
        "nc",
        "ncat",
        "netcat",
        "nmap",
        "python",
        "python3",
        "perl",
        "ruby",
        "node",
        "php",
        "sh",
        "bash",
        "zsh",
        "csh",
        "dash",
        "ash",
        "ssh",
        "scp",
        "sftp",
        "telnet",
        "ftp",
        "apt",
        "apt-get",
        "yum",
        "dnf",
        "pacman",
        "pip",
        "pip3",
        "systemctl",
        "service",
        "init",
        "shutdown",
        "reboot",
        "halt",
        "iptables",
        "ip6tables",
        "nft",
        "insmod",
        "rmmod",
        "modprobe",
        "crontab",
        "at",
        "strace",
        "ltrace",
        "gdb",
        "passwd",
        "useradd",
        "userdel",
        "usermod",
        "groupadd",
    ]
    .into_iter()
    .collect()
}

/// 白名單上有幾個命令的**工作就是執行別的程式**——只看 `parts[0]` 擋不住它們。
///
/// ⚠️ 這是白名單模型最容易漏掉的一類。`env`、`xargs`、`find -exec`、`awk` 的
/// `system()` 全都在白名單上（它們本身是正當的工具），但每一個都能拿來執行
/// 任意命令，等於整個受限 shell 形同虛設。
///
/// 這件事在這台特別嚴重：容器掛著 `/var/run/docker.sock` 且 `pid: host`，
/// 逃出受限 shell 之後拿到的是**宿主機的 root**。
///
/// 做法是保留每個命令的正當用法、只擋掉它們的「執行別的程式」能力。
fn check_process_spawning(command_name: &str, args: &[&str]) -> Result<(), String> {
    match command_name {
        // `env PROG` 會直接 exec 掉 PROG。只留下「查看／設定環境變數」的用法：
        // 無參數，或參數全是 `VAR=value` 形式。
        "env" => {
            for a in args {
                if !a.contains('=') {
                    return Err(format!(
                        "禁止用 env 執行其他程式（'{a}'）。單獨的 env 可以用來查看環境變數。"
                    ));
                }
            }
        }
        // xargs 的全部用途就是拿輸入去執行一個程式，沒有安全的子集。
        "xargs" => {
            return Err("禁止使用 xargs：它的用途就是執行其他程式。".to_string());
        }
        // ⚠️ 這裡只放**檢查得可靠**的：這三個的危險部分都是未加引號的獨立 token
        // （程式名、`-exec` 這種旗標），split_whitespace 切得開。awk / sed 那種
        // 「危險的東西藏在引號裡的腳本本體」是切不開的，所以它們的處置是
        // 直接不放進白名單（見 get_allowed_commands 的說明），而不是在這裡做
        // 一個擋不住的字串比對。
        //
        // find 的動作類參數會執行外部命令或直接刪檔。
        // `\;` 那種形式已被反斜線規則擋掉，但 `+` 結尾不需要反斜線。
        "find" => {
            for a in args {
                if matches!(
                    *a,
                    "-exec" | "-execdir" | "-ok" | "-okdir" | "-delete" | "-fprintf" | "-fls"
                ) {
                    return Err(format!("禁止 find 的 '{a}'：它會執行外部命令或直接刪檔。"));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// 解析命令字串為管道分隔的子命令，並驗證每一個子命令是否安全
/// Parses a command string into pipe-separated sub-commands and validates each one
fn is_command_safe(cmd: &str) -> Result<(), String> {
    let cmd_trimmed = cmd.trim();

    if cmd_trimmed.is_empty() {
        return Ok(());
    }

    // 1. 檢查危險 shell 元字符
    for pattern in get_dangerous_shell_chars() {
        if cmd_trimmed.contains(pattern) {
            return Err(format!("禁止的操作: 包含不安全的字符 '{pattern}'"));
        }
    }

    // 2. 禁止命令串接符號 (;, &&, ||)
    //    我們只允許管道 (|) 和簡單重定向 (>)
    if cmd_trimmed.contains(';') {
        return Err("禁止使用 ';' 串接命令。".to_string());
    }
    if cmd_trimmed.contains("&&") {
        return Err("禁止使用 '&&' 串接命令。".to_string());
    }
    if cmd_trimmed.contains("||") {
        return Err("禁止使用 '||' 串接命令。".to_string());
    }

    // 3. 解析管道：每個 | 分隔的子命令都必須通過白名單
    let allowed = get_allowed_commands();
    let dangerous = get_dangerous_commands();
    let sub_commands: Vec<&str> = cmd_trimmed.split('|').collect();

    for (i, sub_cmd) in sub_commands.iter().enumerate() {
        let sub_trimmed = sub_cmd.trim();
        if sub_trimmed.is_empty() {
            if i > 0 {
                continue; // 允許末尾管道（雖然沒意義）
            }
            return Ok(());
        }

        // 處理輸出重定向：移除 > filename 部分再驗證
        let without_redirect = if let Some(pos) = sub_trimmed.find('>') {
            sub_trimmed[..pos].trim()
        } else {
            sub_trimmed
        };

        let parts: Vec<&str> = without_redirect.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let command_name = parts[0];

        // 3a. 檢查是否在危險命令名單中
        if dangerous.contains(command_name) {
            return Err(format!("命令 '{command_name}' 被禁止執行。"));
        }

        // 3b. 檢查是否在白名單中
        if !allowed.contains(command_name) {
            return Err(format!(
                "命令 '{command_name}' 不在允許列表中。輸入 'help' 查看可用命令。"
            ));
        }

        // 3c. 額外的 rm 安全檢查
        if command_name == "rm" {
            let args_str = without_redirect.to_lowercase();
            if args_str.contains("-rf") || args_str.contains("-fr") || args_str.contains("--no-preserve-root")
            {
                return Err("禁止使用 rm -rf 命令".to_string());
            }
        }

        // 3c-2. 白名單上的命令有幾個能拿來執行**別的**程式，那類要另外擋
        check_process_spawning(command_name, &parts[1..])?;

        // 3d. 檢查參數中是否有嘗試存取敏感路徑
        for part in &parts[1..] {
            let lower = part.to_lowercase();
            if lower.contains("/etc/passwd") || lower.contains("/etc/shadow") || lower.contains("/dev/sd") {
                return Err(format!("禁止存取敏感路徑: {part}"));
            }
        }
    }

    Ok(())
}

/// Tab 補全：檔案和目錄
fn get_completions(partial: &str, current_dir: &str, storage_base: &str) -> Vec<String> {
    let mut completions = Vec::new();

    // 分離命令和參數
    let parts: Vec<&str> = partial.split_whitespace().collect();

    if parts.is_empty() || (parts.len() == 1 && !partial.ends_with(' ')) {
        // 補全命令
        let prefix = parts.first().unwrap_or(&"");
        for cmd in get_available_commands() {
            if cmd.starts_with(prefix) {
                completions.push(cmd.to_string());
            }
        }
    } else {
        // 補全檔案/目錄路徑
        let path_part = if partial.ends_with(' ') {
            ""
        } else {
            parts.last().unwrap_or(&"")
        };

        // rsplit_once 一次做完「有沒有 /」與「切在哪」，取代原本
        // `contains('/')` 之後再 `rfind('/').unwrap()` 的兩段式寫法 ——
        // 那種寫法的 guard 與 unwrap 分處兩行，日後改動 guard 就會變成 panic。
        let (dir_to_search, file_prefix) = if let Some((head, prefix)) = path_part.rsplit_once('/') {
            // 下游需要保留結尾的 '/'（rsplit_once 會把分隔符吃掉）
            let dir = &path_part[..=head.len()];

            // 構建完整路徑
            let full_dir = if dir.starts_with('/') || dir.starts_with("~/") {
                if dir.starts_with("~/") {
                    format!("{}{}", storage_base, &dir[1..])
                } else {
                    format!("{storage_base}{dir}")
                }
            } else {
                format!("{current_dir}/{dir}")
            };
            (full_dir, prefix.to_string())
        } else {
            (current_dir.to_string(), path_part.to_string())
        };

        // 讀取目錄內容
        if let Ok(entries) = std::fs::read_dir(&dir_to_search) {
            for entry in entries.filter_map(std::result::Result::ok) {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&file_prefix) {
                    let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
                    let display_name = if is_dir { format!("{name}/") } else { name };
                    completions.push(display_name);
                }
            }
        }
    }

    completions.sort();
    completions
}

/// 處理內建命令
fn handle_builtin_command(cmd: &str, current_dir: &str) -> Option<String> {
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    if parts.is_empty() {
        return Some(String::new());
    }

    match parts[0] {
        "help" => Some("\x1b[32m╔══════════════════════════════════════════════════════════════╗\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[1;36mKoimsurai NAS Terminal - 受限 Shell 環境\x1b[0m                    \x1b[32m║\x1b[0m\r\n\
             \x1b[32m╠══════════════════════════════════════════════════════════════╣\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m檔案操作:\x1b[0m ls, cat, head, tail, mkdir, touch, cp, mv, rm     \x1b[32m║\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m目錄導航:\x1b[0m cd, pwd, find, stat, file                         \x1b[32m║\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m文字處理:\x1b[0m grep, wc, sort, uniq, cut, tr, tee, diff         \x1b[32m║\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m系統資訊:\x1b[0m df, du, free, uptime, ps, top                     \x1b[32m║\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m媒體工具:\x1b[0m ffmpeg, ffprobe                                   \x1b[32m║\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[33m其他:\x1b[0m     date, echo, clear, history, exit                  \x1b[32m║\x1b[0m\r\n\
             \x1b[32m╠══════════════════════════════════════════════════════════════╣\x1b[0m\r\n\
             \x1b[32m║\x1b[0m  \x1b[34mTab\x1b[0m 自動補全 | \x1b[34m↑↓\x1b[0m 歷史記錄 | \x1b[34mCtrl+C\x1b[0m 取消            \x1b[32m║\x1b[0m\r\n\
             \x1b[32m╚══════════════════════════════════════════════════════════════╝\x1b[0m".to_string()),
        "clear" => Some("\x1b[2J\x1b[H".to_string()),
        "exit" | "logout" => Some("\x1b[33m再見！終端機連線已關閉。\x1b[0m".to_string()),
        "pwd" => Some(current_dir.to_string()),
        _ => None,  // 非內建命令，需要執行
    }
}

/// WebSocket 終端機端點
#[utoipa::path(
    get,
    path = "/api/terminal",
    params(
        ("cols" = Option<u16>, Query, description = "終端機列數"),
        ("rows" = Option<u16>, Query, description = "終端機行數"),
    ),
    responses(
        (status = 101, description = "WebSocket 連線建立"),
        (status = 401, description = "未授權"),
    ),
    tag = "Terminal"
)]
pub async fn terminal_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<TerminalQuery>,
) -> impl IntoResponse {
    tracing::info!(
        "Terminal WebSocket connection requested: cols={}, rows={}",
        query.cols,
        query.rows
    );
    ws.on_upgrade(move |socket| handle_terminal_socket(socket, state, query))
}

async fn handle_terminal_socket(socket: WebSocket, state: AppState, _query: TerminalQuery) {
    let (mut sender, mut receiver) = socket.split();

    // 當前工作目錄（限制在 storage 內）
    let storage_path = state.storage_path.clone();
    let mut current_dir = storage_path.to_string_lossy().to_string();

    // 發送歡迎訊息
    let welcome = "\x1b[2J\x1b[H\
         \x1b[36m╔════════════════════════════════════════════════════╗\x1b[0m\r\n\
         \x1b[36m║\x1b[0m  \x1b[1;32mKoimsurai NAS Terminal\x1b[0m                            \x1b[36m║\x1b[0m\r\n\
         \x1b[36m║\x1b[0m  \x1b[90mSecure Restricted Shell Environment\x1b[0m                \x1b[36m║\x1b[0m\r\n\
         \x1b[36m╠════════════════════════════════════════════════════╣\x1b[0m\r\n\
         \x1b[36m║\x1b[0m  輸入 \x1b[33mhelp\x1b[0m 查看可用命令                            \x1b[36m║\x1b[0m\r\n\
         \x1b[36m╚════════════════════════════════════════════════════╝\x1b[0m\r\n\r\n".to_string();

    if sender.send(Message::Text(welcome)).await.is_err() {
        return;
    }

    // 發送初始提示符
    let prompt = format!(
        "\x1b[36mnas\x1b[0m:\x1b[34m{}\x1b[0m$ ",
        get_display_path(&current_dir, &storage_path.to_string_lossy())
    );
    if sender.send(Message::Text(prompt)).await.is_err() {
        return;
    }

    let mut input_buffer = String::new();
    let mut command_history: Vec<String> = Vec::new();

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                // 處理 JSON 格式的 resize 訊息
                if text.starts_with('{') {
                    if let Ok(resize) = serde_json::from_str::<serde_json::Value>(&text) {
                        if resize.get("type").and_then(|t| t.as_str()) == Some("resize") {
                            // Handle resize - in a real implementation, this would resize the PTY
                            continue;
                        }
                    }
                }

                // 處理字符輸入
                for ch in text.chars() {
                    match ch {
                        '\r' | '\n' => {
                            // Enter 鍵 - 執行命令
                            let _ = sender.send(Message::Text("\r\n".to_string())).await;

                            let cmd = input_buffer.trim().to_string();
                            if !cmd.is_empty() {
                                command_history.push(cmd.clone());
                            }

                            // 執行命令
                            let output =
                                execute_command(&cmd, &mut current_dir, &storage_path.to_string_lossy())
                                    .await;

                            if !output.is_empty() {
                                let _ = sender.send(Message::Text(format!("{output}\r\n"))).await;
                            }

                            // 檢查是否是 exit 命令
                            if cmd.trim() == "exit" || cmd.trim() == "logout" {
                                let _ = sender.close().await;
                                return;
                            }

                            input_buffer.clear();

                            // 發送新提示符
                            let prompt = format!(
                                "\x1b[36mnas\x1b[0m:\x1b[34m{}\x1b[0m$ ",
                                get_display_path(&current_dir, &storage_path.to_string_lossy())
                            );
                            let _ = sender.send(Message::Text(prompt)).await;
                        }
                        '\t' => {
                            // Tab 鍵 - 自動補全
                            let completions =
                                get_completions(&input_buffer, &current_dir, &storage_path.to_string_lossy());

                            if completions.len() == 1 {
                                // 唯一匹配：直接補全
                                let completion = &completions[0];

                                // 找出需要補全的部分
                                let parts: Vec<&str> = input_buffer.split_whitespace().collect();
                                let last_part = if input_buffer.ends_with(' ') {
                                    ""
                                } else {
                                    parts.last().unwrap_or(&"")
                                };

                                // 計算需要添加的字符
                                let to_add = if completion.len() > last_part.len() {
                                    &completion[last_part.len()..]
                                } else {
                                    ""
                                };

                                if !to_add.is_empty() {
                                    input_buffer.push_str(to_add);
                                    let _ = sender.send(Message::Text(to_add.to_string())).await;
                                }
                            } else if completions.len() > 1 {
                                // 多個匹配：顯示所有選項
                                let _ = sender.send(Message::Text("\r\n".to_string())).await;

                                // 格式化輸出（類似 bash）
                                let max_len = completions
                                    .iter()
                                    .map(std::string::String::len)
                                    .max()
                                    .unwrap_or(10)
                                    + 2;
                                let cols = 80 / max_len.max(10);

                                for (i, comp) in completions.iter().enumerate() {
                                    let padded = format!("{comp:<max_len$}");
                                    let _ = sender.send(Message::Text(padded)).await;
                                    if (i + 1) % cols == 0 {
                                        let _ = sender.send(Message::Text("\r\n".to_string())).await;
                                    }
                                }

                                if !completions.len().is_multiple_of(cols) {
                                    let _ = sender.send(Message::Text("\r\n".to_string())).await;
                                }

                                // 重新顯示提示符和當前輸入
                                let prompt = format!(
                                    "\x1b[36mnas\x1b[0m:\x1b[34m{}\x1b[0m$ ",
                                    get_display_path(&current_dir, &storage_path.to_string_lossy())
                                );
                                let _ = sender
                                    .send(Message::Text(format!("{prompt}{input_buffer}")))
                                    .await;

                                // 嘗試補全共同前綴
                                if let Some(common) = find_common_prefix(&completions) {
                                    let parts: Vec<&str> = input_buffer.split_whitespace().collect();
                                    let last_part = if input_buffer.ends_with(' ') {
                                        ""
                                    } else {
                                        parts.last().unwrap_or(&"")
                                    };

                                    if common.len() > last_part.len() {
                                        let to_add = &common[last_part.len()..];
                                        input_buffer.push_str(to_add);
                                        let _ = sender.send(Message::Text(to_add.to_string())).await;
                                    }
                                }
                            }
                        }
                        '\x7f' | '\x08' => {
                            // Backspace
                            if !input_buffer.is_empty() {
                                input_buffer.pop();
                                let _ = sender.send(Message::Text("\x08 \x08".to_string())).await;
                            }
                        }
                        '\x03' => {
                            // Ctrl+C
                            input_buffer.clear();
                            let _ = sender.send(Message::Text("^C\r\n".to_string())).await;
                            let prompt = format!(
                                "\x1b[36mnas\x1b[0m:\x1b[34m{}\x1b[0m$ ",
                                get_display_path(&current_dir, &storage_path.to_string_lossy())
                            );
                            let _ = sender.send(Message::Text(prompt)).await;
                        }
                        '\x1b' => {
                            // Escape sequence (arrow keys, etc.) - skip for now
                        }
                        _ if ch.is_ascii_graphic() || ch == ' ' => {
                            input_buffer.push(ch);
                            let _ = sender.send(Message::Text(ch.to_string())).await;
                        }
                        _ => {}
                    }
                }
            }
            Message::Binary(data) => {
                // 處理二進位資料（同文字處理）
                if let Ok(text) = String::from_utf8(data) {
                    for ch in text.chars() {
                        if ch.is_ascii_graphic() || ch == ' ' {
                            input_buffer.push(ch);
                            let _ = sender.send(Message::Text(ch.to_string())).await;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    tracing::info!("Terminal WebSocket connection closed");
}

/// 找出字串列表的共同前綴
fn find_common_prefix(strings: &[String]) -> Option<String> {
    if strings.is_empty() {
        return None;
    }
    if strings.len() == 1 {
        return Some(strings[0].clone());
    }

    let first = &strings[0];
    let mut prefix_len = first.len();

    for s in &strings[1..] {
        let common = first.chars().zip(s.chars()).take_while(|(a, b)| a == b).count();
        prefix_len = prefix_len.min(common);
    }

    if prefix_len > 0 {
        Some(first[..prefix_len].to_string())
    } else {
        None
    }
}

/// 獲取顯示路徑（相對於 storage）
fn get_display_path(current: &str, storage_base: &str) -> String {
    if current == storage_base {
        "~".to_string()
    } else if let Some(rest) = current.strip_prefix(storage_base) {
        format!("~{rest}")
    } else {
        current.to_string()
    }
}

/// 執行命令
async fn execute_command(cmd: &str, current_dir: &mut String, storage_base: &str) -> String {
    let cmd = cmd.trim();

    if cmd.is_empty() {
        return String::new();
    }

    // 先檢查命令安全性
    if let Err(e) = is_command_safe(cmd) {
        return format!("\x1b[31m錯誤: {e}\x1b[0m");
    }

    // 處理內建命令
    if let Some(output) = handle_builtin_command(cmd, current_dir) {
        return output;
    }

    // 處理 cd 命令
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    if parts[0] == "cd" {
        return handle_cd_command(&parts, current_dir, storage_base);
    }

    // 執行外部命令（在受限環境中）
    execute_external_command(cmd, current_dir, storage_base).await
}

/// 處理 cd 命令
/// 「這個路徑在 storage 底下嗎」。
///
/// ⚠️ 一定要用 `Path::starts_with` 而不是字串的 `str::starts_with`。
/// 後者是**字元前綴**比對：storage 是 `/data/storage` 時，
/// `/data/storage-backup` 也「以它開頭」而被判定為在範圍內 —— 那是一個完全
/// 不同的目錄。（同一類錯誤在 middleware/auth.rs 的 CSRF Origin 比對上也發生過。）
///
/// `Path::starts_with` 比的是**路徑元件**，`/data/storage-backup` 的第二個元件
/// 是 `storage-backup` ≠ `storage`，所以正確地回 false。
fn is_within_storage(path: &str, storage_base: &str) -> bool {
    std::path::Path::new(path).starts_with(storage_base)
}

fn handle_cd_command(parts: &[&str], current_dir: &mut String, storage_base: &str) -> String {
    let target = if parts.len() > 1 { parts[1] } else { "~" };

    let new_path = if target == "~" || target.is_empty() {
        storage_base.to_string()
    } else if target == ".." {
        let path = std::path::Path::new(current_dir);
        if let Some(parent) = path.parent() {
            let parent_str = parent.to_string_lossy().to_string();
            // 不允許離開 storage 目錄
            if is_within_storage(&parent_str, storage_base) {
                parent_str
            } else {
                return "\x1b[31m錯誤: 無法離開 storage 目錄\x1b[0m".to_string();
            }
        } else {
            return "\x1b[31m錯誤: 已在根目錄\x1b[0m".to_string();
        }
    } else if target.starts_with('/') {
        // 絕對路徑 - 必須在 storage 內
        let full_path = format!("{storage_base}{target}");
        if std::path::Path::new(&full_path).exists() {
            full_path
        } else {
            return format!("\x1b[31m錯誤: 目錄不存在: {target}\x1b[0m");
        }
    } else if target.starts_with("~/") {
        format!("{}{}", storage_base, &target[1..])
    } else {
        // 相對路徑
        format!("{current_dir}/{target}")
    };

    // 驗證路徑
    let canonical = match std::fs::canonicalize(&new_path) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return format!("\x1b[31m錯誤: 目錄不存在: {target}\x1b[0m"),
    };

    // 確保在 storage 範圍內
    if !is_within_storage(&canonical, storage_base) {
        return "\x1b[31m錯誤: 無法訪問 storage 目錄之外的路徑\x1b[0m".to_string();
    }

    // 確保是目錄
    if !std::path::Path::new(&canonical).is_dir() {
        return format!("\x1b[31m錯誤: 不是目錄: {target}\x1b[0m");
    }

    *current_dir = canonical;
    String::new()
}

/// 執行外部命令（不透過 sh -c，直接執行白名單命令）
/// Execute external command directly without sh -c to prevent command injection
async fn execute_external_command(cmd: &str, current_dir: &str, storage_base: &str) -> String {
    use tokio::process::Command;

    let cmd_trimmed = cmd.trim();

    // 檢查是否有管道
    if cmd_trimmed.contains('|') {
        return execute_pipeline(cmd_trimmed, current_dir, storage_base).await;
    }

    // 處理輸出重定向 (>)
    let (command_part, redirect_target) = if let Some(pos) = cmd_trimmed.find('>') {
        let target = cmd_trimmed[pos + 1..].trim().to_string();
        let cmd_part = cmd_trimmed[..pos].trim();
        (cmd_part.to_string(), Some(target))
    } else {
        (cmd_trimmed.to_string(), None)
    };

    let parts: Vec<&str> = command_part.split_whitespace().collect();
    if parts.is_empty() {
        return String::new();
    }

    let program = parts[0];
    let args = &parts[1..];

    // 解析路徑參數：確保所有路徑在 storage 範圍內
    let resolved_args: Vec<String> = args
        .iter()
        .map(|a| {
            // 如果參數看起來像路徑且不是 flag，不做特殊處理
            // Command 會以當前目錄為基礎解析相對路徑
            a.to_string()
        })
        .collect();

    let result = Command::new(program)
        .args(&resolved_args)
        .current_dir(current_dir)
        .env("HOME", storage_base)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("TERM", "xterm-256color")
        .output()
        .await;

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            // 處理重定向
            if let Some(ref target) = redirect_target {
                if !target.is_empty() {
                    let target_path = if target.starts_with('/') {
                        format!("{storage_base}{target}")
                    } else {
                        format!("{current_dir}/{target}")
                    };
                    // 驗證路徑在 storage 內
                    if let Ok(canonical) = std::fs::canonicalize(
                        std::path::Path::new(&target_path)
                            .parent()
                            .unwrap_or_else(|| std::path::Path::new(current_dir)),
                    ) {
                        if is_within_storage(&canonical.to_string_lossy(), storage_base) {
                            if let Err(e) = tokio::fs::write(&target_path, stdout.as_bytes()).await {
                                return format!("\x1b[31m寫入錯誤: {e}\x1b[0m");
                            }
                            if !stderr.is_empty() {
                                return format!("\x1b[31m{}\x1b[0m", stderr.replace('\n', "\r\n"));
                            }
                            return String::new();
                        }
                    }
                    return "\x1b[31m錯誤: 重定向目標不在 storage 範圍內\x1b[0m".to_string();
                }
            }

            let mut result = String::new();
            if !stdout.is_empty() {
                result.push_str(&stdout.replace('\n', "\r\n"));
            }
            if !stderr.is_empty() {
                let _ = write!(result, "\x1b[31m{}\x1b[0m", stderr.replace('\n', "\r\n"));
            }
            result.trim_end().to_string()
        }
        Err(e) => format!("\x1b[31m執行錯誤: {e}\x1b[0m"),
    }
}

/// 安全地執行管道命令 — 使用 OS 層級 Pipe 串流，不將整個 stdout 載入記憶體
/// 每個子行程的 stdout 直接接到下一個子行程的 stdin（透過 `tokio::io::copy` 串流），
/// 固定 buffer size，避免 OOM 和死鎖（如 `yes | head -n 5`）。
async fn execute_pipeline(cmd: &str, current_dir: &str, storage_base: &str) -> String {
    use std::process::Stdio;
    use tokio::process::Command;

    let segments: Vec<&str> = cmd.split('|').collect();

    if segments.is_empty() {
        return String::new();
    }

    // 啟動第一個命令
    let first_parts: Vec<&str> = segments[0].split_whitespace().collect();
    if first_parts.is_empty() {
        return String::new();
    }

    let mut prev_child = match Command::new(first_parts[0])
        .args(&first_parts[1..])
        .current_dir(current_dir)
        .env("HOME", storage_base)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("TERM", "xterm-256color")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return format!("\x1b[31m執行錯誤 ({}): {}\x1b[0m", first_parts[0], e),
    };

    // 收集所有中間子行程以便等待它們完成
    let mut children: Vec<(String, tokio::process::Child)> = Vec::new();

    // 依序啟動後續命令，以 tokio::io::copy 串流連接
    for segment in &segments[1..] {
        let parts: Vec<&str> = segment.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        // 取得前一個行程的 stdout
        let Some(prev_stdout) = prev_child.stdout.take() else {
            // 前一個行程沒有 stdout，等待它結束
            children.push((first_parts[0].to_string(), prev_child));
            return "\x1b[31m管道錯誤: 無法取得前一個命令的輸出\x1b[0m".to_string();
        };

        let mut next_child = match Command::new(parts[0])
            .args(&parts[1..])
            .current_dir(current_dir)
            .env("HOME", storage_base)
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .env("TERM", "xterm-256color")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = prev_child.kill().await;
                return format!("\x1b[31m執行錯誤 ({}): {}\x1b[0m", parts[0], e);
            }
        };

        // 取得下一個行程的 stdin，用 tokio::io::copy 串流（固定 buffer，不會 OOM）
        let next_stdin = next_child.stdin.take();
        tokio::spawn(async move {
            if let Some(mut stdin) = next_stdin {
                let mut stdout_reader = prev_stdout;
                // tokio::io::copy 使用固定大小 buffer 串流，不會將整個輸出載入記憶體
                let _ = tokio::io::copy(&mut stdout_reader, &mut stdin).await;
                // drop stdin 讓下游行程收到 EOF
            }
        });

        // 將前一個 child 存起來等待
        children.push((first_parts[0].to_string(), prev_child));
        prev_child = next_child;
    }

    // 等待最後一個行程的輸出（有 stdout 上限保護）
    const MAX_OUTPUT_SIZE: usize = 10 * 1024 * 1024; // 10 MB 上限
    match prev_child.wait_with_output().await {
        Ok(output) => {
            // 等待所有中間行程結束（它們的 stdout 已被消費）
            for (_, mut child) in children {
                let _ = child.wait().await;
            }

            let stdout = if output.stdout.len() > MAX_OUTPUT_SIZE {
                let truncated = String::from_utf8_lossy(&output.stdout[..MAX_OUTPUT_SIZE]);
                format!(
                    "{}\r\n\x1b[33m[輸出過長，已截斷至 10MB]\x1b[0m",
                    truncated.replace('\n', "\r\n")
                )
            } else {
                String::from_utf8_lossy(&output.stdout).replace('\n', "\r\n")
            };

            let stderr = String::from_utf8_lossy(&output.stderr);

            let mut result = String::new();
            if !stdout.is_empty() {
                result.push_str(&stdout);
            }
            if !stderr.trim().is_empty() {
                let _ = write!(result, "\x1b[31m{}\x1b[0m", stderr.replace('\n', "\r\n"));
            }
            result.trim_end().to_string()
        }
        Err(e) => {
            // 清理所有子行程
            for (_, mut child) in children {
                let _ = child.kill().await;
            }
            format!("\x1b[31m執行錯誤: {e}\x1b[0m")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 白名單通過與否。
    fn ok(cmd: &str) -> bool {
        is_command_safe(cmd).is_ok()
    }

    // ─────────────────────── 該放行的 ───────────────────────

    /// help 訊息與白名單不同步的話，使用者會照著 help 打然後被擋，
    /// 而錯誤訊息說的是「不在允許列表中」——兩邊互相打臉，很難查。
    // ══════════════════ cd：路徑不能離開 storage ══════════════════
    //
    // ⚠️ 這一組是整支檔案裡最需要釘的：cd 走偏了不會有錯誤訊息，只是後續
    //    每一個命令都在錯的目錄下執行（而那個目錄可能在 storage 之外）。
    use std::fs;
    use tempfile::TempDir;

    /// 準備一個 storage 根，回傳 (`TempDir`, 已 canonicalize 的路徑字串)。
    ///
    /// ⚠️ 一定要 canonicalize：`handle_cd_command` 內部會 canonicalize 之後
    /// 跟 `storage_base` 做字串比對，而 `TempDir` 給的路徑在某些系統上含符號連結
    /// （macOS 的 /tmp → /private/tmp）。不先正規化的話比對永遠不成立，
    /// 測試會以「無法訪問 storage 目錄之外的路徑」失敗，而程式其實是對的。
    fn storage() -> (TempDir, String) {
        let dir = TempDir::new().expect("tempdir");
        let base = fs::canonicalize(dir.path())
            .expect("canonicalize")
            .to_string_lossy()
            .to_string();
        (dir, base)
    }

    #[test]
    fn cd_into_a_subdirectory_moves_there() {
        let (dir, base) = storage();
        fs::create_dir_all(dir.path().join("照片/2026")).expect("mkdir");

        let mut cwd = base.clone();
        assert_eq!(handle_cd_command(&["cd", "照片"], &mut cwd, &base), "");
        assert_eq!(cwd, format!("{base}/照片"));

        assert_eq!(handle_cd_command(&["cd", "2026"], &mut cwd, &base), "");
        assert_eq!(cwd, format!("{base}/照片/2026"));
    }

    #[test]
    fn cd_with_no_argument_and_tilde_both_go_home() {
        let (dir, base) = storage();
        fs::create_dir_all(dir.path().join("a")).expect("mkdir");

        for args in [vec!["cd"], vec!["cd", "~"]] {
            let mut cwd = format!("{base}/a");
            assert_eq!(handle_cd_command(&args, &mut cwd, &base), "");
            assert_eq!(cwd, base, "{args:?} 應該回到 storage 根");
        }
    }

    #[test]
    fn cd_dotdot_walks_up_but_stops_at_the_storage_root() {
        let (dir, base) = storage();
        fs::create_dir_all(dir.path().join("a/b")).expect("mkdir");

        let mut cwd = format!("{base}/a/b");
        assert_eq!(handle_cd_command(&["cd", ".."], &mut cwd, &base), "");
        assert_eq!(cwd, format!("{base}/a"));
        assert_eq!(handle_cd_command(&["cd", ".."], &mut cwd, &base), "");
        assert_eq!(cwd, base);

        // ⚠️ 在根目錄再往上必須被擋，而且 cwd 不能被改動
        let err = handle_cd_command(&["cd", ".."], &mut cwd, &base);
        assert!(err.contains("無法離開"), "實際訊息：{err}");
        assert_eq!(cwd, base, "被拒絕時 cwd 不該被改掉");
    }

    #[test]
    fn an_absolute_path_is_relative_to_the_storage_root() {
        let (dir, base) = storage();
        fs::create_dir_all(dir.path().join("etc")).expect("mkdir");

        // 使用者眼中的 `/etc` 是 NAS 的根目錄底下，不是宿主機的 /etc
        let mut cwd = base.clone();
        assert_eq!(handle_cd_command(&["cd", "/etc"], &mut cwd, &base), "");
        assert_eq!(cwd, format!("{base}/etc"));
        assert_ne!(cwd, "/etc");
    }

    #[test]
    fn cd_to_a_missing_directory_or_a_file_reports_an_error() {
        let (dir, base) = storage();
        fs::write(dir.path().join("a.txt"), b"x").expect("write");

        let mut cwd = base.clone();
        let err = handle_cd_command(&["cd", "沒有這個目錄"], &mut cwd, &base);
        assert!(err.contains("不存在"), "實際：{err}");
        assert_eq!(cwd, base);

        let err = handle_cd_command(&["cd", "a.txt"], &mut cwd, &base);
        assert!(err.contains("不是目錄"), "實際：{err}");
        assert_eq!(cwd, base);
    }

    #[test]
    fn a_symlink_pointing_outside_the_storage_root_is_refused() {
        // ⚠️ 這是 canonicalize 存在的理由：字串層面 `<base>/escape` 完全正常，
        //    只有解析完符號連結才看得出它指向 storage 之外。
        #[cfg(unix)]
        {
            let (dir, base) = storage();
            let outside = TempDir::new().expect("outside");
            std::os::unix::fs::symlink(outside.path(), dir.path().join("escape")).expect("symlink");

            let mut cwd = base.clone();
            let err = handle_cd_command(&["cd", "escape"], &mut cwd, &base);
            assert!(err.contains("storage"), "符號連結逃逸必須被擋，實際：{err}");
            assert_eq!(cwd, base);
        }
    }

    #[test]
    fn a_sibling_directory_sharing_the_storage_prefix_is_refused() {
        // ⚠️ storage_base 的比對是**字串前綴**。base 是 `/x/storage` 時，
        //    `/x/storage-backup` 也「以它開頭」——跟 CSRF 那次 starts_with 的
        //    繞過完全同一類。
        #[cfg(unix)]
        {
            let parent = TempDir::new().expect("parent");
            let base_dir = parent.path().join("storage");
            let sibling = parent.path().join("storage-backup");
            fs::create_dir_all(&base_dir).expect("mkdir");
            fs::create_dir_all(&sibling).expect("mkdir");
            let base = fs::canonicalize(&base_dir)
                .expect("canonicalize")
                .to_string_lossy()
                .to_string();

            let mut cwd = base.clone();
            let err = handle_cd_command(&["cd", "../storage-backup"], &mut cwd, &base);
            assert!(
                !err.is_empty(),
                "同前綴的兄弟目錄必須被擋，實際卻成功了（cwd = {cwd}）"
            );
            assert_eq!(cwd, base);
        }
    }

    #[test]
    fn is_within_storage_compares_path_components_not_characters() {
        // ⚠️ 這是上面那條 sibling 測試的單元版。字串前綴比對會讓
        //    `/data/storage-backup` 通過，而它是一個完全不同的目錄。
        assert!(is_within_storage("/data/storage", "/data/storage"));
        assert!(is_within_storage("/data/storage/a/b", "/data/storage"));

        assert!(!is_within_storage("/data/storage-backup", "/data/storage"));
        assert!(!is_within_storage("/data/storageXYZ/secret", "/data/storage"));
        assert!(!is_within_storage("/etc", "/data/storage"));
        assert!(
            !is_within_storage("/data", "/data/storage"),
            "上層目錄不算在範圍內"
        );
    }

    // ══════════════════ 顯示路徑與內建命令 ══════════════════

    #[test]
    fn the_storage_root_is_displayed_as_a_tilde() {
        assert_eq!(get_display_path("/data/storage", "/data/storage"), "~");
        assert_eq!(get_display_path("/data/storage/照片", "/data/storage"), "~/照片");
        // 不在 storage 底下時原樣顯示（理論上到不了，但不該顯示成 `~something`）
        assert_eq!(get_display_path("/etc", "/data/storage"), "/etc");
    }

    #[test]
    fn builtin_commands_are_handled_without_spawning_a_process() {
        assert!(handle_builtin_command("help", "/x").is_some());
        assert_eq!(
            handle_builtin_command("clear", "/x"),
            Some("\x1b[2J\x1b[H".to_string())
        );
        assert_eq!(
            handle_builtin_command("pwd", "/data/x"),
            Some("/data/x".to_string())
        );
        assert!(handle_builtin_command("exit", "/x").is_some());
        assert!(handle_builtin_command("logout", "/x").is_some());
        // ⚠️ 回 None 代表「這不是內建命令，交給外部執行」——白名單檢查在那條路上。
        //    誤判成內建的話等於繞過白名單。
        assert_eq!(handle_builtin_command("ls", "/x"), None);
        assert_eq!(handle_builtin_command("helpme", "/x"), None);
    }

    // ══════════════════ Tab 補全 ══════════════════

    #[test]
    fn completion_of_an_empty_or_partial_word_offers_commands() {
        let (_dir, base) = storage();
        let all = get_completions("", &base, &base);
        assert!(all.contains(&"ls".to_string()));

        let l = get_completions("l", &base, &base);
        assert!(l.contains(&"ls".to_string()));
        assert!(!l.contains(&"pwd".to_string()), "不該提示不符前綴的命令");
    }

    #[test]
    fn completion_after_a_space_offers_files_in_the_current_directory() {
        let (dir, base) = storage();
        fs::write(dir.path().join("note.txt"), b"x").expect("write");
        fs::create_dir_all(dir.path().join("照片")).expect("mkdir");

        let c = get_completions("cat ", &base, &base);
        assert!(c.contains(&"note.txt".to_string()));
        // 目錄要帶結尾斜線，使用者才知道還能繼續往下打
        assert!(c.contains(&"照片/".to_string()));
    }

    #[test]
    fn completion_filters_by_the_partial_file_name() {
        let (dir, base) = storage();
        fs::write(dir.path().join("note.txt"), b"x").expect("write");
        fs::write(dir.path().join("other.txt"), b"x").expect("write");

        let c = get_completions("cat no", &base, &base);
        assert_eq!(c, vec!["note.txt".to_string()]);
    }

    #[test]
    fn completion_descends_into_a_subdirectory_path() {
        let (dir, base) = storage();
        fs::create_dir_all(dir.path().join("照片")).expect("mkdir");
        fs::write(dir.path().join("照片/貓.jpg"), b"x").expect("write");

        let c = get_completions("cat 照片/", &base, &base);
        assert_eq!(c, vec!["貓.jpg".to_string()]);
    }

    #[test]
    fn find_common_prefix_behaves() {
        assert_eq!(find_common_prefix(&[]), None);
        assert_eq!(
            find_common_prefix(&["only".to_string()]),
            Some("only".to_string())
        );
        assert_eq!(
            find_common_prefix(&["note.txt".to_string(), "nothing".to_string()]),
            Some("not".to_string())
        );
        // ⚠️ 沒有共同前綴時要回 None 而不是空字串 —— 呼叫端用它決定「要不要把
        //    使用者打到一半的字補上去」，補一個空字串等於把輸入清掉。
        assert_eq!(find_common_prefix(&["abc".to_string(), "xyz".to_string()]), None);
    }

    #[test]
    fn help_text_only_advertises_whitelisted_commands() {
        let allowed = get_allowed_commands();
        for name in get_available_commands() {
            assert!(allowed.contains(name), "補全清單有 {name:?} 但白名單沒有");
        }
    }

    #[test]
    fn plain_whitelisted_commands_pass() {
        for cmd in ["ls", "ls -la", "pwd", "cat notes.txt", "echo hi", "df -h"] {
            assert!(ok(cmd), "{cmd:?} 應該放行");
        }
    }

    #[test]
    fn empty_input_is_fine() {
        assert!(ok(""));
        assert!(ok("   "));
    }

    #[test]
    fn pipelines_of_whitelisted_commands_pass() {
        assert!(ok("ls -la | grep txt | wc -l"));
    }

    #[test]
    fn simple_output_redirect_passes() {
        assert!(ok("ls > out.txt"));
    }

    // ─────────────────── 該擋下的：不在白名單 ───────────────────

    #[test]
    fn unknown_commands_are_rejected() {
        for cmd in ["definitely-not-a-command", "vim", "git"] {
            assert!(!ok(cmd), "{cmd:?} 不在白名單，應該擋下");
        }
    }

    #[test]
    fn absolute_paths_do_not_bypass_the_whitelist() {
        // ⚠️ 白名單比對的是 parts[0] 的字面值，所以 "/bin/sh" 不等於 "sh"——
        //    它會落在「不在白名單」而被擋。這條釘住那個結果。
        for cmd in ["/bin/sh", "/usr/bin/env", "./ls"] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    #[test]
    fn explicitly_dangerous_commands_are_rejected() {
        for cmd in [
            "sudo ls",
            "bash",
            "sh -c id",
            "curl http://x",
            "python3 -c 1",
            "systemctl restart x",
        ] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    // ─────────────────── 該擋下的：shell 元字符 ───────────────────

    #[test]
    fn command_substitution_is_rejected() {
        for cmd in ["echo `id`", "echo $(id)", "echo ${PATH}", "echo $((1+1))"] {
            assert!(!ok(cmd), "{cmd:?} 是命令替換，應該擋下");
        }
    }

    #[test]
    fn chaining_operators_are_rejected() {
        for cmd in ["ls; id", "ls && id", "ls || id"] {
            assert!(!ok(cmd), "{cmd:?} 是命令串接，應該擋下");
        }
    }

    #[test]
    fn newline_and_backslash_are_rejected() {
        // ⚠️ newline 會被當成命令分隔；反斜線是 find -exec ... \; 的必要零件。
        assert!(!ok("ls\nid"));
        assert!(!ok("ls\rid"));
        assert!(!ok(r"find . -exec id {} \;"));
    }

    #[test]
    fn process_substitution_and_heredoc_are_rejected() {
        for cmd in ["diff <(ls) <(ls)", "cat << EOF", "ls >> out.txt"] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    // ─────────────────── 該擋下的：管道裡的每一段 ───────────────────

    #[test]
    fn every_stage_of_a_pipeline_is_checked() {
        // ⚠️ 只檢查第一段的話，`ls | bash` 就過了。這條釘住「每一段都要查」。
        assert!(!ok("ls | bash"));
        assert!(!ok("ls | sudo tee /etc/passwd"));
        assert!(!ok("cat x | python3"));
    }

    // ─────────────────── 該擋下的：特定的額外規則 ───────────────────

    #[test]
    fn rm_rf_is_rejected_but_plain_rm_is_allowed() {
        assert!(ok("rm file.txt"));
        for cmd in ["rm -rf /", "rm -fr /", "rm --no-preserve-root -rf /", "RM -RF /"] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    #[test]
    fn sensitive_paths_are_rejected_in_arguments() {
        for cmd in [
            "cat /etc/passwd",
            "head /etc/shadow",
            "cat /dev/sda1",
            "cat /ETC/PASSWD",
        ] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    // ─────────────── 該擋下的：可以再生一個行程的白名單命令 ───────────────
    //
    // ⚠️ 這一組是白名單最容易漏掉的地方：命令本身在白名單上，但它的**工作
    //    就是執行別的命令**。只看 parts[0] 的話這些全部放行，而它們每一個
    //    都等於任意命令執行。
    //
    //    這台容器掛著 /var/run/docker.sock 且 pid: host，逃出受限 shell
    //    之後拿到的是宿主機的 root。

    #[test]
    fn env_cannot_be_used_to_launch_another_program() {
        assert!(!ok("env bash"), "env 會直接 exec 後面那個程式");
        assert!(!ok("env sh -c id"));
        assert!(!ok("env FOO=1 python3"));
        // 單純看環境變數是它原本的用途，要留著
        assert!(ok("env"));
    }

    #[test]
    fn awk_and_sed_are_not_on_the_whitelist_at_all() {
        // ⚠️ 不是「擋掉危險用法」而是**整個命令不放行**。理由見
        //    get_allowed_commands：危險的東西藏在引號裡的腳本本體，而這一層
        //    看到的是未經 shell 拆解的字串，切不開也就擋不住。
        //    `awk 'BEGIN{system("id")}'` 與 `sed '1e id'` 都是實際可用的逃逸。
        for cmd in [
            "awk '{print $1}'",
            "awk 'BEGIN{system(\"id\")}'",
            "awk 'BEGIN{ system (\"id\") }'",
            "sed 's/a/b/'",
            "sed '1e id' x",
            "ls | awk '{print}'",
        ] {
            assert!(!ok(cmd), "{cmd:?} 應該擋下");
        }
    }

    #[test]
    fn xargs_cannot_be_used_to_launch_another_program() {
        assert!(!ok("echo id | xargs bash -c"));
        assert!(!ok("ls | xargs sh"));
    }

    #[test]
    fn env_with_only_assignments_is_still_allowed() {
        // 設環境變數本身沒問題，問題在後面接一個程式名
        assert!(ok("env FOO=1"));
    }

    #[test]
    fn find_exec_cannot_launch_another_program() {
        // `\;` 那種形式已被反斜線規則擋掉，但 `+` 結尾不需要反斜線
        assert!(!ok("find . -exec bash -c id {} +"));
        assert!(ok("find . -name '*.txt'"), "一般的 find 用法要留著");
    }
}
