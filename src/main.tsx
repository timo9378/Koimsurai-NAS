import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { initErrorReporting } from "./lib/errorReporting";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("找不到 #root —— index.html 被改壞了");

// 錯誤上報（自架 GlitchTip）。沒設 VITE_SENTRY_DSN 就整個不啟用，
// 所以本機開發預設是關的。不 await —— 它是動態載入的，不該擋住首屏。
void initErrorReporting();

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
