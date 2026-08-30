"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  ArrowLeft,
  Power,
  Wifi,
  Battery,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin, useRegister, useTwoFactorLogin } from "@/features/auth/api/useAuth";
import { cn } from "@/lib/utils";

type Step = "credentials" | "two_factor";

export function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  // 2FA 階段需要的 state
  const [tempToken, setTempToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const twoFactorLoginMutation = useTwoFactorLogin();

  const isLoading =
    loginMutation.isPending || registerMutation.isPending || twoFactorLoginMutation.isPending;

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!username || !password) {
      setError("Please fill in all fields");
      return;
    }

    if (!isLogin) {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (!inviteCode) {
        setError("Invite code is required");
        return;
      }
    }

    try {
      if (isLogin) {
        // ⚠️ TODO：`remember` 沒有送出。Rust 的 LoginRequest 只有 username / password，
        // serde 會靜默丟棄未知欄位 —— 也就是說這個核取方塊從來就沒有作用過，
        // 只是先前手寫的 TS 型別多宣告了一個欄位，把這件事遮住了。
        // 要讓它生效需要後端補欄位並據以調整 cookie/JWT 的有效期。
        const res = await loginMutation.mutateAsync({ username, password });
        // 後端回 requires_2fa = true 時需要第二階段
        if (res && typeof res === "object" && "requires_2fa" in res && res.requires_2fa) {
          setTempToken(res.temp_token);
          setStep("two_factor");
          setPassword(""); // 清掉原密碼，避免殘留
          return;
        }
      } else {
        await registerMutation.mutateAsync({
          username,
          password,
          invite_code: inviteCode,
        });
        setIsLogin(true);
        setPassword("");
        setSuccess("Registration successful! Please log in.");
        return;
      }

      window.location.href = "/";
    } catch (err: unknown) {
      console.error("Auth error:", err);
      if (err && typeof err === "object" && "response" in err) {
        const axiosError = err as { response: { data: { message: string } } };
        setError(axiosError.response?.data?.message || "Authentication failed");
      } else {
        setError("Authentication failed");
      }
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const code = twoFactorCode.trim();
    if (!code) {
      setError("Enter the 6-digit code or a backup code");
      return;
    }
    try {
      await twoFactorLoginMutation.mutateAsync({ temp_token: tempToken, code });
      window.location.href = "/";
    } catch (err: unknown) {
      console.error("2FA error:", err);
      if (err && typeof err === "object" && "response" in err) {
        const axiosError = err as { response: { data: { message: string }; status?: number } };
        // temp_token 過期會回 401，需要回到第一階段重 login
        if (
          axiosError.response?.status === 401 &&
          /temp token|expired/i.test(axiosError.response?.data?.message || "")
        ) {
          setError("Session expired. Please log in again.");
          setStep("credentials");
          setTempToken("");
          setTwoFactorCode("");
          return;
        }
        setError(axiosError.response?.data?.message || "Invalid code");
      } else {
        setError("Invalid code");
      }
    }
  };

  const cancelTwoFactor = () => {
    setStep("credentials");
    setTempToken("");
    setTwoFactorCode("");
    setError("");
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
    setInviteCode("");
    setStep("credentials");
    setTempToken("");
    setTwoFactorCode("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-cover bg-center overflow-y-auto font-sans text-zinc-100"
      style={{
        backgroundImage:
          "url(https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop)",
      }}
    >
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Top Bar - Time & Date */}
      <div className="relative z-10 w-full pt-8 sm:pt-20 flex justify-center shrink-0">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full flex flex-col items-center justify-center space-y-2 text-center"
        >
          {currentTime && (
            <>
              <h1 className="text-5xl sm:text-7xl font-thin tracking-tight drop-shadow-lg leading-none">
                {currentTime.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </h1>
              <p className="text-xl font-medium text-zinc-200 drop-shadow-md">
                {currentTime.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </>
          )}
        </motion.div>
      </div>

      {/* Main Login Card */}
      <div className="relative z-10 w-full max-w-md px-4 my-4 sm:mb-20 shrink-0">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center space-y-6 p-8 rounded-3xl bg-black/20 backdrop-blur-xl border border-white/10 shadow-2xl"
        >
          {/* Logo */}
          <div className="relative group mb-2 sm:mb-4">
            <div className="relative w-24 h-24 sm:w-40 sm:h-40 transition-transform duration-300 group-hover:scale-105">
              <img
                src="/Images/logo.svg"
                alt="Koimsurai NAS"
                className="w-full h-full drop-shadow-2xl filter brightness-110"
              />
            </div>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold tracking-wide drop-shadow-md">
              {step === "two_factor" ? (
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6" /> Two-Factor Verification
                </span>
              ) : isLogin ? (
                username || "Koimsurai User"
              ) : (
                "Create Account"
              )}
            </h2>
            <p className="text-sm text-zinc-400">
              {step === "two_factor"
                ? "Enter the 6-digit code from your authenticator app"
                : isLogin
                  ? "Enter your credentials to access"
                  : "Join the Koimsurai ecosystem"}
            </p>
          </div>

          {/* ─── 2FA 第二階段 ─── */}
          {step === "two_factor" ? (
            <form onSubmit={(e) => void handleTwoFactorSubmit(e)} className="w-full space-y-4">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <Input
                  type="text"
                  inputMode="text"
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="123 456 or backup code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  className="h-11 pl-10 pr-4 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:bg-black/40 focus-visible:ring-0 transition-all rounded-xl backdrop-blur-md font-mono tracking-widest text-center"
                  maxLength={20}
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center"
                >
                  <p className="text-sm text-red-200">{error}</p>
                </motion.div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-blue-500/80 hover:bg-blue-500 text-white rounded-xl backdrop-blur-md transition-all"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
              </Button>

              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={cancelTwoFactor}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-2 px-4 py-2 rounded-full hover:bg-white/5"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to login
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="w-full space-y-4">
              <div className="space-y-3">
                <div className="relative group">
                  <Input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-11 pl-4 pr-4 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:bg-black/40 focus-visible:ring-0 transition-all rounded-xl backdrop-blur-md"
                  />
                </div>

                <div className="relative group">
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(
                      "h-11 pl-4 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:bg-black/40 focus-visible:ring-0 transition-all rounded-xl backdrop-blur-md",
                      isLogin ? "pr-12" : "pr-4",
                    )}
                  />
                  {isLogin && (
                    <Button
                      type="submit"
                      size="icon"
                      variant="ghost"
                      disabled={isLoading}
                      className="absolute right-1 top-1 h-9 w-9 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 rounded-lg transition-colors"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>

                <AnimatePresence>
                  {!isLogin && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-3 overflow-hidden"
                    >
                      <Input
                        type="password"
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="h-11 pl-4 pr-4 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:bg-black/40 focus-visible:ring-0 transition-all rounded-xl backdrop-blur-md"
                      />
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="Invite Code"
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value)}
                          className="h-11 pl-4 pr-12 border-white/10 bg-black/20 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:bg-black/40 focus-visible:ring-0 transition-all rounded-xl backdrop-blur-md"
                        />
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          disabled={isLoading}
                          className="absolute right-1 top-1 h-9 w-9 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 rounded-lg transition-colors"
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {isLogin && (
                <div className="flex items-center justify-between px-1">
                  <div
                    className="flex items-center gap-2 group cursor-pointer"
                    onClick={() => setRemember(!remember)}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 rounded border border-zinc-600 flex items-center justify-center transition-colors",
                        remember
                          ? "bg-blue-500 border-blue-500"
                          : "bg-transparent group-hover:border-zinc-500",
                      )}
                    >
                      {remember && (
                        <ArrowRight className="w-3 h-3 text-white rotate-[-45deg] mb-0.5 ml-0.5" />
                      )}
                    </div>
                    <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors select-none">
                      Keep me logged in
                    </span>
                  </div>
                  <button
                    type="button"
                    className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center"
                >
                  <p className="text-sm text-red-200">{error}</p>
                </motion.div>
              )}

              {success && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center"
                >
                  <p className="text-sm text-green-200">{success}</p>
                </motion.div>
              )}

              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-2 px-4 py-2 rounded-full hover:bg-white/5"
                >
                  {isLogin ? (
                    "Create an account"
                  ) : (
                    <>
                      <ArrowLeft className="h-3 w-3" /> Back to login
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>

      {/* Bottom Status Bar */}
      <div className="relative z-10 w-full p-3 sm:p-6 flex justify-between items-end text-zinc-400 shrink-0">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-zinc-200">Koimsurai NAS</h3>
          <p className="text-xs opacity-60">v1.0.0 • System Normal</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/5 hover:bg-black/30 transition-colors cursor-pointer">
            <Wifi className="w-4 h-4" />
            <span className="text-xs font-medium">Connected</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/5 hover:bg-black/30 transition-colors cursor-pointer">
            <Battery className="w-4 h-4" />
            <span className="text-xs font-medium">100%</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-md border border-white/5 hover:bg-black/30 transition-colors cursor-pointer group">
            <Power className="w-4 h-4 group-hover:text-red-400 transition-colors" />
            <span className="text-xs font-medium group-hover:text-red-400 transition-colors">
              Power
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
