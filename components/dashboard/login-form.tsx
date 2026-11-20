"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function LoginForm({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const router = useRouter()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!configured || pending) return
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to sign in.")
      router.replace("/dashboard")
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in. Try again.")
      setPending(false)
    }
  }

  return <form onSubmit={submit} className="page-enter space-y-6">
    <div><label htmlFor="password" className="eyebrow mb-3 block">ACCESS KEY</label><div className="flex border-b border-border/80 transition-colors focus-within:border-primary"><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" autoFocus required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full bg-transparent text-[14px] tracking-[0.04em] outline-none placeholder:text-muted-foreground/60 disabled:opacity-50" placeholder="Enter your password" disabled={!configured || pending} /><button type="button" onClick={() => setShowPassword((value) => !value)} className="py-2 pl-3 text-[8px] font-semibold tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground" tabIndex={-1}>{showPassword ? "HIDE" : "SHOW"}</button></div></div>
    {error && <p role="alert" className="border-l border-destructive px-3 py-2 text-xs leading-5 text-destructive">{error}</p>}
    {!configured && <p role="alert" className="border-l border-amber-400 px-3 py-2 text-xs leading-5 text-amber-200">Authentication needs setup. Add <code className="font-mono">HOMEOS_PASSWORD_HASH</code> and a 32-character <code className="font-mono">HOMEOS_SESSION_SECRET</code> to your server environment.</p>}
    <Button type="submit" className="h-11 w-full rounded-sm text-[9px] font-semibold tracking-[0.19em]" disabled={!configured || pending}>{pending ? "VERIFYING ACCESS" : "ENTER HOMEOS"}</Button>
  </form>
}

export function LoginBrand() {
  return <div className="wordmark text-[16px] font-semibold tracking-[0.24em]">H<span className="text-primary">.</span>OS</div>
}
