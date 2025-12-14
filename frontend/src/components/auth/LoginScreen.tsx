"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { User, ArrowRight, Loader2, ArrowLeft } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLogin, useRegister } from "@/features/auth/api/useAuth"
import { cn } from "@/lib/utils"

export function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [error, setError] = useState("")

  const loginMutation = useLogin()
  const registerMutation = useRegister()

  const isLoading = loginMutation.isPending || registerMutation.isPending

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
        await loginMutation.mutateAsync({ username, password })
      } else {
        await registerMutation.mutateAsync({ 
          username, 
          password,
          invite_code: inviteCode 
        })
        // After successful registration, switch to login
        setIsLogin(true)
        setPassword("")
        setConfirmPassword("")
        setInviteCode("")
        setError("Registration successful! Please log in.")
        return
      }
      
      // Redirect to home page
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
      {/* Dark overlay/background */}
      <div className="absolute inset-0 bg-zinc-950" />
      
      <div className="relative z-10 flex flex-col items-center space-y-8 w-full max-w-md px-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center space-y-4"
        >
          <Avatar className="h-24 w-24 border-2 border-zinc-700 shadow-2xl">
            <AvatarImage src="/avatar-placeholder.png" />
            <AvatarFallback className="bg-zinc-800 text-2xl text-zinc-400">
              <User />
            </AvatarFallback>
          </Avatar>
          
          <h1 className="text-2xl font-medium text-zinc-200 drop-shadow-md">
            {isLogin ? (username || "User") : "Create Account"}
          </h1>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="w-full max-w-xs"
        >
          <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
            <div className="space-y-3">
              <Input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 border-zinc-700 bg-zinc-800/50 text-center text-zinc-200 placeholder:text-zinc-500 focus-visible:border-zinc-500 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              
              <div className="relative">
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(
                    "h-10 border-zinc-700 bg-zinc-800/50 text-center text-zinc-200 placeholder:text-zinc-500 focus-visible:border-zinc-500 focus-visible:ring-0 focus-visible:ring-offset-0",
                    isLogin && "pr-10"
                  )}
                />
                {isLogin && (
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    disabled={isLoading}
                    className="absolute right-0 top-0 h-10 w-10 text-zinc-400 hover:bg-transparent hover:text-zinc-200"
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
                      className="h-10 border-zinc-700 bg-zinc-800/50 text-center text-zinc-200 placeholder:text-zinc-500 focus-visible:border-zinc-500 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder="Invite Code"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        className="h-10 border-zinc-700 bg-zinc-800/50 text-center text-zinc-200 placeholder:text-zinc-500 focus-visible:border-zinc-500 focus-visible:ring-0 focus-visible:ring-offset-0 pr-10"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        variant="ghost"
                        disabled={isLoading}
                        className="absolute right-0 top-0 h-10 w-10 text-zinc-400 hover:bg-transparent hover:text-zinc-200"
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

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center text-sm text-red-400 drop-shadow-md"
              >
                {error}
              </motion.p>
            )}

            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={toggleMode}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
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

      <div className="absolute bottom-8 flex flex-col items-center space-y-2 text-zinc-600">
        <p className="text-sm hover:text-zinc-400 cursor-pointer transition-colors">Sleep</p>
        <p className="text-sm hover:text-zinc-400 cursor-pointer transition-colors">Restart</p>
        <p className="text-sm hover:text-zinc-400 cursor-pointer transition-colors">Shut Down</p>
      </div>
    </div>
  )
}