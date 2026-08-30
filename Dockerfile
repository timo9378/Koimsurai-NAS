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

# `pnpm build` = tsc --noEmit && vite build，型別錯誤在這裡就會擋下建置
RUN pnpm build

# ⚠️ vite 的 `sourcemap: 'hidden'` **只拿掉 sourceMappingURL 註解，不會阻止
# .map 被供應** —— 實測 /assets/*.js.map 直接 200。這步是必要的，不是清潔癖。
# （要送 GlitchTip 的話，上傳步驟要插在這一行之前。）
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
