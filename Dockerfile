# ============================================
# Koimsurai NAS — 單一映像同時供應 API 與前端
#
# 遷移前是兩個容器（Next.js standalone :13001 + Rust :3000）。
# 前端改成純 SPA 之後就沒有 server 端邏輯了，靜態檔交給 Rust 的 ServeDir
# （見 backend/src/lib.rs 的 attach_spa）—— production 從此零 Node 進程。
# ============================================

# ── Stage 1：前端 ────────────────────────────────────────────────────
FROM node:26-alpine AS frontend
# ⚠️ Node 25 起不再隨附 corepack，`corepack enable` 會 command not found。
RUN npm install -g pnpm@12.1.0
WORKDIR /app

# 先只複製 manifest，讓相依層能被快取（原始碼改動不會讓 pnpm install 重跑）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# `pnpm build` = tsc --noEmit && vite build，型別錯誤在這裡就會擋下建置。
# ⚠️ VITE_RELEASE 沒帶的話 SDK 不會帶版本標記 —— 功能仍正常，只是 GlitchTip 上的
#    issue 歸不到某次部署。要帶就 `VITE_RELEASE=$(git rev-parse --short HEAD)`。
# 錯誤上報的 DSN。⚠️ 這裡放的 key 是**假的** —— 真 key 在後端的
# SENTRY_FRONTEND_DSN，轉發時才換上（見 src/lib/errorReporting.ts 的說明）。
# 空值 = SDK 整個不啟用。
ARG VITE_SENTRY_DSN
ARG VITE_RELEASE
RUN pnpm build

# ── source map → GlitchTip ──────────────────────────────────────────
# 三件事綁在 build 裡，所以不存在「忘記傳」或「順序錯」：先烙 debug id、
# 再上傳、最後從映像刪掉。分開做的話順序錯的症狀是「stack trace 依然
# minify，且沒有任何錯誤訊息」—— 查不出來的那種。
#
# 用 @sentry/cli 而不是 glitchtip 自己的：GlitchTip 的 find_source_files
# 本來就優先比對 debug_id，兩者相容。

# 1) inject：在每支 JS 與它的 .map 裡烙一個 UUID。純本機操作，不碰網路。
#    有了它，比對不再依賴檔名或 release 名稱 —— 那是最容易錯的一環。
RUN pnpm exec sentry-cli sourcemaps inject dist/assets

# 2) upload。⚠️ token 走 BuildKit secret 而不是 ARG —— ARG 會留在映像歷史裡。
#    ⚠️ 沒帶 secret 時整步跳過（例如 CI 只想驗 build 過不過）；有帶就必須成功，
#      刻意讓它會擋下部署：靜靜跳過等於錯誤追蹤白裝，而那不會有人發現。
ARG SENTRY_URL=https://glitchtip.koimsurai.com
ARG SENTRY_ORG=koimsurai
ARG SENTRY_PROJECT=koimsurai-nas
RUN --mount=type=secret,id=sentry_token \
    if [ -s /run/secrets/sentry_token ]; then \
      SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_token)" \
      SENTRY_URL="$SENTRY_URL" SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" \
      pnpm exec sentry-cli sourcemaps upload dist/assets \
        --release "${VITE_RELEASE:-unknown}" --url-prefix '~/assets'; \
    else \
      echo "⚠️  沒有 sentry_token secret，跳過 source map 上傳"; \
    fi

# 3) 刪掉 .map。
#    ⚠️ 這步是必要的，而且原因跟直覺相反：vite 的 `sourcemap: 'hidden'` **只拿掉
#      bundle 結尾的 sourceMappingURL 註解，不會阻止檔案被供應**。實測過 ——
#      /assets/*.js.map 直接 200，整站原始碼可下載。
#      GlitchTip 已經有了自己那份，production 映像不需要留。
RUN find dist -name '*.map' -delete

# ── Stage 2：後端 ────────────────────────────────────────────────────
# 釘住版本以求可重現。⚠️ 不要往下降：Cargo.lock 裡的 time-core 需要 1.88+，
# 用 1.87 會在相依解析階段就失敗（error: package requires rustc 1.88.0）。
FROM rust:1.98-slim-bookworm AS backend
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 相依快取：先用空殼 source 建一次，讓依賴層與原始碼層分開。
# ⚠️ 現在是 workspace（根 Cargo.toml + backend/），manifest 要兩份都複製。
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml ./backend/
RUN mkdir -p backend/src backend/src/bin \
    && echo "fn main() {}" > backend/src/main.rs \
    && echo "" > backend/src/lib.rs \
    && echo "fn main() {}" > backend/src/bin/export_types.rs \
    && cargo build --release --locked \
    && rm -rf backend/src

COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
COPY packages ./packages

# touch 讓 cargo 認得原始碼變新了（前面空殼建置留下的時間戳會騙過它）
RUN touch backend/src/main.rs backend/src/lib.rs \
    && cargo build --release --locked --bin Koimsurai_NAS

# ── Stage 3：runtime ─────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 ffmpeg procps \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 -s /bin/bash appuser

COPY --from=backend  /app/target/release/Koimsurai_NAS /app/koimsurai-nas
COPY --from=frontend /app/dist                          /app/static

RUN mkdir -p /data/storage /data/db && chown -R appuser:appuser /data /app
USER appuser

EXPOSE 3000

ENV RUST_LOG=info
ENV DATABASE_URL=sqlite:///data/db/nas.db
ENV STORAGE_PATH=/data/storage
# attach_spa 讀這個；目錄裡沒有 index.html 就會略過 SPA fallback 只跑 API
ENV STATIC_DIR=/app/static

CMD ["/app/koimsurai-nas"]
