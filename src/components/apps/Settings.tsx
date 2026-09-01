"use client";

import React, { useState } from "react";
import {
  Palette,
  HardDrive,
  User,
  Info,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  Layout,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  FolderSync,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import type { DiskInfo } from "@/types/api";
import type { DockPosition } from "@/store/window-store";
import { useWindowStore } from "@/store/window-store";
import { useSystemStatus } from "@/features/system/api/useSystem";
import { usagePercent } from "./dashboard/metrics";
import {
  useTwoFactorStatus,
  useTwoFactorSetup,
  useTwoFactorVerifySetup,
  useTwoFactorDisable,
} from "@/features/auth/api/useAuth";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type SettingsSection =
  | "appearance"
  | "dock"
  | "storage"
  | "webdav"
  | "account"
  | "security"
  | "about";

interface SettingsItemProps {
  icon: React.ElementType;
  label: string;
  sectionId: SettingsSection;
  isActive: boolean;
  onClick: () => void;
}

const SettingsItem = ({ icon: Icon, label, isActive, onClick }: SettingsItemProps) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
      isActive
        ? "bg-blue-500/20 text-blue-500 dark:text-blue-400"
        : "text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/5",
    )}
  >
    <div
      className={cn(
        "p-1.5 rounded-lg",
        isActive ? "bg-blue-500/20" : "bg-gray-200 dark:bg-white/10",
      )}
    >
      <Icon className="w-4 h-4" />
    </div>
    <span className="flex-1">{label}</span>
    <ChevronRight className="w-4 h-4 opacity-40" />
  </button>
);

const AppearanceSection = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">外觀</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">自訂 NAS 介面外觀</p>
      </div>

      <div className="space-y-4">
        <fieldset className="contents">
          <legend className="text-sm font-medium text-gray-700 dark:text-zinc-300">主題模式</legend>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "light", label: "淺色", icon: Sun },
              { id: "dark", label: "深色", icon: Moon },
              { id: "system", label: "跟隨系統", icon: Monitor },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                  theme === opt.id
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5",
                )}
              >
                <opt.icon className="w-6 h-6" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
};

const DockSection = () => {
  const { dockPosition, setDockPosition } = useWindowStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Dock</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">調整 Dock 列位置</p>
      </div>

      <div className="space-y-4">
        <fieldset className="contents">
          <legend className="text-sm font-medium text-gray-700 dark:text-zinc-300">
            Dock 位置
          </legend>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "left" as DockPosition, label: "左側", icon: ArrowLeft },
              { id: "bottom" as DockPosition, label: "底部", icon: ArrowDown },
              { id: "right" as DockPosition, label: "右側", icon: ArrowRight },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDockPosition(opt.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                  dockPosition === opt.id
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5",
                )}
              >
                <opt.icon className="w-6 h-6" />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
};

const StorageSection = () => {
  const { data: systemStatus } = useSystemStatus();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">儲存空間</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">檢視磁碟使用狀況</p>
      </div>

      {systemStatus?.disks.map((disk: DiskInfo) => {
        const usedPercent = usagePercent(disk.total_space - disk.available_space, disk.total_space);

        return (
          <div
            key={disk.mount_point}
            className="p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-gray-500 dark:text-zinc-400" />
                <span className="font-medium text-gray-900 dark:text-white">
                  {disk.name || disk.mount_point}
                </span>
              </div>
              <span className="text-sm text-gray-500 dark:text-zinc-400">
                {formatBytes(disk.total_space - disk.available_space)} /{" "}
                {formatBytes(disk.total_space)}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  usedPercent > 90
                    ? "bg-red-500"
                    : usedPercent > 70
                      ? "bg-yellow-500"
                      : "bg-blue-500",
                )}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 dark:text-zinc-400">
              可用: {formatBytes(disk.available_space)} ({(100 - usedPercent).toFixed(1)}%)
            </div>
          </div>
        );
      })}

      {(!systemStatus?.disks || systemStatus.disks.length === 0) && (
        <div className="text-sm text-gray-500 dark:text-zinc-400">載入中...</div>
      )}
    </div>
  );
};

/**
 * WebDAV 的說明與掛載網址。
 *
 * ⚠️ 這個區塊存在的理由：WebDAV 功能是完整的，但**整個 UI 之前沒有一處提到它**
 * —— 使用者不會知道有這個東西。更麻煩的是它與 2FA 互斥（Basic 認證沒有第二
 * 因素的位置），而開啟 2FA 之後 WebDAV 會直接停止運作、客戶端只會顯示
 * 「密碼錯誤」。那個因果關係一定要寫在使用者看得到的地方。
 */
const WebDavSection = () => {
  const { data: status } = useTwoFactorStatus();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/webdav/`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("複製失敗");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">WebDAV</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
          把 NAS 掛成網路磁碟機（Windows／macOS／Linux 都支援）。
        </p>
      </div>

      <div className="p-4 rounded-xl border border-gray-200 dark:border-white/10 space-y-3">
        <div className="text-xs text-gray-500 dark:text-zinc-400">掛載網址</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-sm px-2 py-1.5 rounded bg-black/5 dark:bg-white/5">
            {url}
          </code>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          帳號密碼跟登入這個介面用的同一組。
        </p>
      </div>

      {status?.enabled ? (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-1">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">這個帳號目前用不了 WebDAV</span>
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
            你已經啟用兩步驟驗證，而 WebDAV 走的 HTTP Basic 認證沒有輸入第二因素的
            地方。客戶端會一直顯示「密碼錯誤」—— 那不是密碼的問題。
            目前還沒有應用程式專用密碼，所以要用 WebDAV 就得先關掉 2FA。
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          ⚠️ 啟用兩步驟驗證之後 WebDAV 會停止運作 —— Basic 認證沒有輸入第二因素的
          地方，而目前沒有應用程式專用密碼。
        </p>
      )}
    </div>
  );
};

const AccountSection = () => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">帳戶</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">管理您的帳戶設定</p>
      </div>

      <div className="p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">管理員</div>
            <div className="text-sm text-gray-500 dark:text-zinc-400">admin</div>
          </div>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
        <p className="text-sm text-amber-700 dark:text-amber-400">密碼修改功能即將推出</p>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────
   Security — 兩階段驗證 (TOTP) 設定
   流程：
     idle (未啟用) → setup (拿 QR + 輸入第一個 code) → verified (顯示 backup codes)
     enabled        → 顯示狀態 + 停用按鈕
   ───────────────────────────────────────────────── */
type SecurityStep = "idle" | "setup" | "verified" | "disable";

const SecuritySection = () => {
  const { data: status, isLoading: statusLoading, refetch } = useTwoFactorStatus();
  const setupMutation = useTwoFactorSetup();
  const verifySetupMutation = useTwoFactorVerifySetup();
  const disableMutation = useTwoFactorDisable();

  const [step, setStep] = useState<SecurityStep>("idle");
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedAllCodes, setCopiedAllCodes] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [error, setError] = useState("");

  const startSetup = async () => {
    setError("");
    try {
      const data = await setupMutation.mutateAsync();
      setSetupData(data);
      setStep("setup");
    } catch (e) {
      console.error(e);
      setError("Failed to start 2FA setup");
    }
  };

  const verifySetup = async () => {
    setError("");
    if (code.trim().length !== 6) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    try {
      const data = await verifySetupMutation.mutateAsync(code.trim());
      setBackupCodes(data.backup_codes);
      setStep("verified");
      setCode("");
    } catch {
      setError("Invalid code, please try again");
    }
  };

  const finishSetup = () => {
    setStep("idle");
    setSetupData(null);
    setBackupCodes([]);
    setCopiedAllCodes(false);
    void refetch();
  };

  const startDisable = () => {
    setError("");
    setDisablePassword("");
    setDisableCode("");
    setStep("disable");
  };

  const confirmDisable = async () => {
    setError("");
    if (!disablePassword || !disableCode) {
      setError("Both password and code are required");
      return;
    }
    try {
      await disableMutation.mutateAsync({
        password: disablePassword,
        code: disableCode.trim(),
      });
      setStep("idle");
      setDisablePassword("");
      setDisableCode("");
      void refetch();
    } catch {
      setError("Wrong password or code");
    }
  };

  const copyToClipboard = async (text: string, kind: "secret" | "codes") => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "secret") {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 1500);
      } else {
        setCopiedAllCodes(true);
        setTimeout(() => setCopiedAllCodes(false), 1500);
      }
    } catch {
      // ignore
    }
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const enabled = status?.enabled === true;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">兩階段驗證</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
          密碼之外再加一層驗證碼，防止密碼洩漏導致帳號被入侵
        </p>
      </div>

      {/* 狀態卡 */}
      <div
        className={cn(
          "p-4 rounded-xl border space-y-3",
          enabled
            ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
            : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10",
        )}
      >
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <div className="flex-1">
            <div
              className={cn(
                "font-medium",
                enabled
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300",
              )}
            >
              {enabled ? "2FA 已啟用" : "2FA 尚未啟用"}
            </div>
            {enabled && (
              <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                還剩 {status.backup_codes_remaining} 組 backup codes
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ⚠️ 啟用之前就要說清楚：2FA 與 WebDAV 是互斥的。使用者按下去之後
          WebDAV 客戶端只會顯示「密碼錯誤」，沒有任何地方會告訴他原因。 */}
      {!enabled && step === "idle" && (
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          啟用之後 <strong>WebDAV 會停止運作</strong> —— Basic 認證沒有輸入第二因素的
          地方，而目前沒有應用程式專用密碼。細節見「WebDAV」那一頁。
        </p>
      )}

      {/* idle 狀態下的主要動作 */}
      {step === "idle" && (
        <div className="flex flex-wrap gap-2">
          {!enabled && (
            <button
              onClick={() => void startSetup()}
              disabled={setupMutation.isPending}
              className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {setupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              啟用兩階段驗證
            </button>
          )}
          {enabled && (
            <button
              onClick={startDisable}
              className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-sm font-medium transition-colors border border-red-500/20"
            >
              停用 2FA
            </button>
          )}
        </div>
      )}

      {/* setup 步驟：QR + 輸入 code */}
      {step === "setup" && setupData && (
        <div className="space-y-4 p-5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900/50">
          <div className="space-y-2">
            <h4 className="font-medium text-gray-900 dark:text-white">
              1. 用 Authenticator app 掃描 QR Code
            </h4>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Google Authenticator / Authy / 1Password 任一個都可以
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="bg-white p-3 rounded-lg shrink-0 self-center">
              <QRCodeSVG value={setupData.otpauth_uri} size={180} level="M" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                若無法掃描，可手動輸入 secret：
              </p>
              <div className="flex items-center gap-2 p-2 rounded-md bg-gray-100 dark:bg-zinc-800 font-mono text-xs break-all">
                <span className="flex-1">{setupData.secret}</span>
                <button
                  onClick={() => void copyToClipboard(setupData.secret, "secret")}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
                  title="複製 secret"
                >
                  {copiedSecret ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <h4 className="font-medium text-gray-900 dark:text-white">
              2. 輸入 app 顯示的 6 位 code
            </h4>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="w-full max-w-[200px] h-11 px-3 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-800 text-center font-mono text-lg tracking-widest focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => void verifySetup()}
              disabled={verifySetupMutation.isPending || code.length !== 6}
              className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              {verifySetupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              驗證並啟用
            </button>
            <button
              onClick={() => {
                setStep("idle");
                setSetupData(null);
                setCode("");
                setError("");
              }}
              className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-zinc-300 text-sm font-medium transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* verified 步驟：顯示 8 個 backup codes */}
      {step === "verified" && backupCodes.length > 0 && (
        <div className="space-y-4 p-5 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <h4 className="font-medium text-amber-900 dark:text-amber-200">
                儲存 Backup Codes（只會顯示這一次）
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-300/80">
                換手機或 Authenticator app
                故障時，每組可使用一次。請存到密碼管理器或印出來放安全地方。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <div
                key={c}
                className="p-2 rounded-md bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-500/20 text-center tracking-wider"
              >
                {c}
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => void copyToClipboard(backupCodes.join("\n"), "codes")}
              className="px-4 py-2 rounded-lg bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 border border-gray-200 dark:border-white/10 text-sm font-medium transition-colors flex items-center gap-2"
            >
              {copiedAllCodes ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copiedAllCodes ? "已複製" : "複製全部"}
            </button>
            <button
              onClick={finishSetup}
              className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
            >
              我已儲存好了
            </button>
          </div>
        </div>
      )}

      {/* disable 步驟：要密碼 + code 確認 */}
      {step === "disable" && (
        <div className="space-y-4 p-5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <h4 className="font-medium text-red-900 dark:text-red-200">確認停用 2FA</h4>
              <p className="text-xs text-red-700 dark:text-red-300/80">
                請輸入密碼 + 當前 6 位 code（或 backup code）以確認操作
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="當前密碼"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-800 focus:border-red-500 focus:outline-none"
            />
            <input
              type="text"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="6 位 code 或 backup code"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-zinc-800 focus:border-red-500 focus:outline-none font-mono"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-100 dark:bg-red-500/20 border border-red-300 dark:border-red-500/40">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void confirmDisable()}
              disabled={disableMutation.isPending}
              className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              {disableMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              確認停用
            </button>
            <button
              onClick={() => {
                setStep("idle");
                setError("");
              }}
              className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-zinc-300 text-sm font-medium transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AboutSection = () => {
  const { data: systemStatus } = useSystemStatus();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">關於</h3>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">系統資訊</p>
      </div>

      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
          <HardDrive className="w-10 h-10 text-white" />
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-gray-900 dark:text-white">Koimsurai NAS</div>
          <div className="text-sm text-gray-500 dark:text-zinc-400">版本 1.0.0</div>
        </div>
      </div>

      <div className="space-y-2">
        {[
          {
            label: "CPU 使用率",
            value: systemStatus ? `${Math.round(systemStatus.cpu_usage ?? 0)}%` : "-",
          },
          {
            label: "記憶體",
            value: systemStatus
              ? `${formatBytes(systemStatus.used_memory)} / ${formatBytes(systemStatus.total_memory)}`
              : "-",
          },
          {
            label: "Swap",
            value: systemStatus
              ? `${formatBytes(systemStatus.used_swap)} / ${formatBytes(systemStatus.total_swap)}`
              : "-",
          },
          {
            label: "GPU",
            value: systemStatus?.gpu
              ? `${systemStatus.gpu.name} (${Math.round(systemStatus.gpu.utilization ?? 0)}%)`
              : "無 GPU 資訊",
          },
          { label: "磁碟數量", value: systemStatus ? `${systemStatus.disks.length} 個磁碟` : "-" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-white/5 last:border-0"
          >
            <span className="text-sm text-gray-500 dark:text-zinc-400">{item.label}</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="text-center pt-4">
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          © 2025-2026 Koimsurai. All rights reserved.
        </p>
      </div>
    </div>
  );
};

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: "appearance", label: "外觀", icon: Palette },
  { id: "dock", label: "Dock", icon: Layout },
  { id: "storage", label: "儲存空間", icon: HardDrive },
  { id: "webdav", label: "WebDAV", icon: FolderSync },
  { id: "account", label: "帳戶", icon: User },
  { id: "security", label: "安全性", icon: ShieldCheck },
  { id: "about", label: "關於", icon: Info },
];

export const Settings = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");

  const renderSection = () => {
    switch (activeSection) {
      case "appearance":
        return <AppearanceSection />;
      case "dock":
        return <DockSection />;
      case "storage":
        return <StorageSection />;
      case "webdav":
        return <WebDavSection />;
      case "account":
        return <AccountSection />;
      case "security":
        return <SecuritySection />;
      case "about":
        return <AboutSection />;
    }
  };

  return (
    <div className="h-full flex bg-gray-50/80 dark:bg-zinc-950/20">
      {/* Sidebar */}
      <div className="w-56 border-r border-gray-200 dark:border-white/10 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
            設定
          </h2>
        </div>
        {SECTIONS.map((section) => (
          <SettingsItem
            key={section.id}
            icon={section.icon}
            label={section.label}
            sectionId={section.id}
            isActive={activeSection === section.id}
            onClick={() => setActiveSection(section.id)}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg">{renderSection()}</div>
      </div>
    </div>
  );
};
