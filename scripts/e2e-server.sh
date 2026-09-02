#!/usr/bin/env bash
# 起一個**只給 E2E 用**的後端實例：自己的 temp DB 與 storage，跑完就丟。
#
# ⚠️ 絕對不要指向真實環境。E2E 會註冊帳號、建檔、刪檔。
#
# 後端本身就是 SPA 的靜態檔伺服器（見 lib.rs 的 attach_spa），所以 E2E 打的是
# 「production 實際長的樣子」——同源、同一個行程，而不是 vite dev server 加
# proxy。跨來源的 cookie／CSRF 行為在 dev server 底下驗不出來。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="${E2E_TMP:-$(mktemp -d)}"

export PORT="${E2E_PORT:-3098}"
export DATABASE_URL="sqlite://$TMP/e2e.db?mode=rwc"
export STORAGE_PATH="$TMP/storage"
export STATIC_DIR="$ROOT/dist"
export JWT_SECRET="e2e_only_secret_not_used_anywhere_else"
export REGISTRATION_INVITE_CODE="${E2E_INVITE_CODE:-e2e_invite}"
export COOKIE_SECURE="false"
# ⚠️ 預設 info 不是 warn。Lighthouse CI 靠 `startServerReadyPattern`（"running on"）
# 判斷伺服器起來了沒，而那行是 `tracing::info!` —— RUST_LOG=warn 會把它濾掉，
# lhci 就在伺服器還沒 listen 時開始抓頁面，症狀是一整排
# `FAILED_DOCUMENT_REQUEST` 加上 `net::ERR_ABORTED`。
# Playwright 那邊走 URL 探測（/health），不受影響。
export RUST_LOG="${RUST_LOG:-info}"

mkdir -p "$STORAGE_PATH"

if [ ! -d "$STATIC_DIR" ]; then
  echo "找不到 $STATIC_DIR —— 先跑 pnpm build" >&2
  exit 1
fi

BIN="$ROOT/backend/target/debug/Koimsurai_NAS"
[ -x "$BIN" ] || BIN="$ROOT/target/debug/Koimsurai_NAS"
if [ ! -x "$BIN" ]; then
  echo "找不到 server binary —— 先跑 cargo build --bin Koimsurai_NAS" >&2
  exit 1
fi

# ⚠️ 這個腳本**不會重編**。改了後端卻忘了 build 的話，E2E 測的是上一版的 server
# —— 而症狀是「新端點回 404」，看起來像程式寫錯，很容易往錯的方向追（我就這樣
# 追了一輪：以為路由註冊錯了，其實是 binary 舊的）。
# 這裡不自動 build（那會讓 webServer 的啟動逾時難以預測），只出聲。
NEWER=$(find "$ROOT/backend/src" -name '*.rs' -newer "$BIN" -print -quit 2>/dev/null || true)
if [ -n "$NEWER" ]; then
  echo "⚠️  backend/src 比 $BIN 新（例如 $NEWER）——" >&2
  echo "    這支腳本不會重編，先跑 cargo build --bin Koimsurai_NAS，否則測到的是舊 server。" >&2
fi

exec "$BIN"
