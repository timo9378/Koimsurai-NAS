"use client"

import React, { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { User, ArrowRight, Loader2, ArrowLeft, Power, Wifi, Battery, Monitor } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useLogin, useRegister } from "@/features/auth/api/useAuth"
import { cn } from "@/lib/utils"

export function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [currentTime, setCurrentTime] = useState(new Date())

  const loginMutation = useLogin()
  const registerMutation = useRegister()

  const isLoading = loginMutation.isPending || registerMutation.isPending

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!username || !password) {
      setError("Please fill in all fields")
      return
    }

    if (!isLogin) {
      if (password !== confirmPassword) {
        setError("Passwords do not match")
        return
      }
      if (!inviteCode) {
        setError("Invite code is required")
        return
      }
    }

    try {
      if (isLogin) {
        await loginMutation.mutateAsync({ username, password, remember })
      } else {
        await registerMutation.mutateAsync({ 
          username, 
          password,
          invite_code: inviteCode 
        })
        setIsLogin(true)
        setPassword("")
        setConfirmPassword("")
        setInviteCode("")
        setError("Registration successful! Please log in.")
        return
      }
      
      window.location.href = '/';
    } catch (err: unknown) {
      console.error("Auth error:", err)
      if (err && typeof err === 'object' && 'response' in err) {
          const axiosError = err as { response: { data: { message: string } } };
          setError(axiosError.response?.data?.message || "Authentication failed");
      } else {
          setError("Authentication failed");
      }
    }
  }

  const toggleMode = () => {
    setIsLogin(!isLogin)
    setError("")
    setPassword("")
    setConfirmPassword("")
    setInviteCode("")
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-cover bg-center overflow-hidden font-sans text-zinc-100"
         style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop)' }}>
      
      {/* Background Overlay */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Top Bar - Time & Date */}
      <div className="relative z-10 w-full p-8 flex flex-col items-center pt-16">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col items-center space-y-1"
        >
          <h1 className="text-7xl font-thin tracking-tight drop-shadow-lg">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
          </h1>
          <p className="text-xl font-medium text-zinc-200 drop-shadow-md">
            {currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </motion.div>
      </div>

      {/* Main Login Card */}
      <div className="relative z-10 w-full max-w-md px-4 mb-20">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center space-y-6 p-8 rounded-3xl bg-black/20 backdrop-blur-xl border border-white/10 shadow-2xl"
        >
          {/* Avatar */}
          <div className="relative group">
            <Avatar className="h-28 w-28 border-4 border-white/10 shadow-xl transition-transform duration-300 group-hover:scale-105">
              <AvatarImage src="/avatar-placeholder.png" />
              <AvatarFallback className="bg-zinc-800/80 text-3xl text-zinc-400 backdrop-blur-md">
                <User />
              </AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 rounded-full border-4 border-black/20 shadow-lg" />
          </div>
          
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold tracking-wide drop-shadow-md">
              {isLogin ? (username || "Koimsurai User") : "Create Account"}
            </h2>
            <p className="text-sm text-zinc-400">
              {isLogin ? "Enter your credentials to access" : "Join the Koimsurai ecosystem"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
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
                    isLogin ? "pr-12" : "pr-4"
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
                <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setRemember(!remember)}>
                  <div className={cn(
                    "w-4 h-4 rounded border border-zinc-600 flex items-center justify-center transition-colors",
                    remember ? "bg-blue-500 border-blue-500" : "bg-transparent group-hover:border-zinc-500"
                  )}>
                    {remember && <ArrowRight className="w-3 h-3 text-white rotate-[-45deg] mb-0.5 ml-0.5" />}
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors select-none">Keep me logged in</span>
                </div>
                <button type="button" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
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
        </motion.div>
      </div>

      {/* Bottom Status Bar */}
      <div className="relative z-10 w-full p-6 flex justify-between items-end text-zinc-400">
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
            <span className="text-xs font-medium group-hover:text-red-400 transition-colors">Power</span>
          </div>
        </div>
      </div>
    </div>
  )
}