/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** GlitchTip 的 DSN。⚠️ 裡面那把 key 是假的，見 src/lib/errorReporting.ts */
  readonly VITE_SENTRY_DSN?: string;
  /** 部署版本標記（build 時帶入 git short sha），讓 issue 歸得到某次部署 */
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
