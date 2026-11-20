"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const overview = { label: "Overview", short: "OV", href: "/dashboard" }
const navigationGroups = [
  { label: "STORAGE", items: [
    { label: "Cloud", short: "CL", href: "/cloud" },
    { label: "Files", short: "FS", href: "/files" },
    { label: "Backups", short: "BK", href: "/backups" },
  ] },
  { label: "MEDIA", items: [
    { label: "Photos", short: "PH", href: "/photos" },
    { label: "Movies", short: "MV", href: "/movies" },
  ] },
  { label: "SERVICES", items: [
    { label: "Database", short: "DB", href: "/database" },
    { label: "Deployments", short: "DP", href: "/deployments" },
    { label: "Docker", short: "DK", href: "/docker" },
  ] },
]
const navigation = [overview, ...navigationGroups.flatMap((group) => group.items)]

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const pageTitle = navigation.find((item) => pathname.startsWith(item.href))?.label ?? "Overview"

  async function signOut() {
    setLoggingOut(true)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (response.ok) router.replace("/login")
      else setLoggingOut(false)
    } catch {
      setLoggingOut(false)
    }
  }

  return <div className="min-h-screen bg-background text-foreground">
    {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 animate-fade-in bg-black/70 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />}
    <aside
      className={cn("fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border/80 bg-sidebar transition-[width,transform] duration-300 ease-out md:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}
      style={{ width: collapsed ? 78 : 252 }}
    >
      <Link href="/dashboard" className={cn("flex h-[84px] shrink-0 items-center border-b border-border/70 px-6", collapsed && "justify-center px-0")}>
        <div className="min-w-0"><div className="wordmark text-[17px] font-semibold tracking-[0.22em]">H<span className="text-primary">.</span>OS</div>{!collapsed && <p className="mt-1.5 whitespace-nowrap text-[9px] font-medium tracking-[0.24em] text-muted-foreground">PRIVATE SYSTEMS</p>}</div>
      </Link>

      <div className="px-3 pt-9">
        <nav className="space-y-5" aria-label="Main navigation">
          {(() => {
            const active = pathname === overview.href || pathname === "/"
            return <Link href={overview.href} title={collapsed ? overview.label : undefined} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)} className={cn(
              "group relative flex h-11 items-center gap-3 rounded-lg px-3 text-[12px] font-medium tracking-[0.015em] transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
              collapsed && "justify-center px-0",
            )}>
              {active && <span className="absolute -left-3 h-5 w-px bg-primary" />}
              <span className={cn("font-mono text-[10px] tracking-[0.08em]", active ? "text-primary" : "text-muted-foreground/75")}>{collapsed ? overview.short : "01"}</span>
              {!collapsed && <span>{overview.label}</span>}
              {active && !collapsed && <span className="ml-auto h-px w-4 bg-primary/70" />}
            </Link>
          })()}
          {navigationGroups.map((group) => <section key={group.label}>
            {(() => {
              const expanded = expandedGroups.includes(group.label)
              const regionId = `navigation-${group.label.toLowerCase()}`
              return <>
                <h2>
                  <button type="button" aria-expanded={expanded} aria-controls={regionId} title={collapsed ? group.label : undefined} onClick={() => setExpandedGroups((groups) => expanded ? groups.filter((item) => item !== group.label) : [...groups, group.label])} className={cn("flex h-9 w-full items-center rounded-lg px-3 text-left text-[9px] font-semibold tracking-[0.19em] text-muted-foreground/75 transition-colors hover:bg-foreground/[0.035] hover:text-foreground", collapsed && "justify-center px-0") }>
                    {collapsed ? group.label.slice(0, 2) : group.label}
                    {!collapsed && <span aria-hidden="true" className="ml-auto font-mono text-[11px]">{expanded ? "−" : "+"}</span>}
                  </button>
                </h2>
                <div id={regionId} hidden={!expanded} className="mt-1 space-y-1">
                  {group.items.map(({ label, short, href }) => {
                    const index = navigation.findIndex((item) => item.href === href)
                    const active = pathname === href || (href === "/dashboard" && pathname === "/")
                    return <Link key={href} href={href} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)} className={cn(
                      "group relative flex h-11 items-center gap-3 rounded-lg px-3 text-[12px] font-medium tracking-[0.015em] transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
                      collapsed && "justify-center px-0",
                    )}>
                      {active && <span className="absolute -left-3 h-5 w-px bg-primary" />}
                      <span className={cn("font-mono text-[10px] tracking-[0.08em]", active ? "text-primary" : "text-muted-foreground/75")}>{collapsed ? short : `0${index + 1}`}</span>
                      {!collapsed && <span>{label}</span>}
                      {active && !collapsed && <span className="ml-auto h-px w-4 bg-primary/70" />}
                    </Link>
                  })}
                </div>
              </>
            })()}
          </section>)}
        </nav>
      </div>

      <div className="mt-auto px-3 pb-5">
        {!collapsed && <div className="mb-4 border-t border-border/75 px-3 pt-4"><p className="text-[9px] tracking-[0.17em] text-muted-foreground">ENCRYPTED SESSION</p><p className="mt-1.5 flex items-center gap-2 text-[11px] font-medium"><span className="size-1.5 rounded-full bg-emerald-400" />Connected</p></div>}
        <button type="button" onClick={() => setCollapsed((value) => !value)} className={cn("flex h-9 w-full items-center rounded-lg px-3 text-[10px] font-medium tracking-[0.1em] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground", collapsed && "justify-center px-0")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand navigation" : undefined}>{collapsed ? "EXPAND" : "COLLAPSE"}</button>
      </div>
    </aside>

    <div className={cn("min-h-screen transition-[margin] duration-300", collapsed ? "md:ml-[78px]" : "md:ml-[252px]")}>
      <header className="sticky top-0 z-20 flex h-[66px] items-center border-b border-border/70 bg-background/88 px-5 backdrop-blur-xl sm:px-9">
        <button className="mr-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">MENU</button>
        <div className="flex min-w-0 items-center gap-3 text-[10px] tracking-[0.12em]"><span className="hidden text-muted-foreground sm:inline">HOMEOS</span><span className="hidden h-3 w-px bg-border sm:block" /><span className="truncate font-semibold text-foreground">{pageTitle.toUpperCase()}</span></div>
        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          <span className="hidden items-center gap-2 text-[9px] font-semibold tracking-[0.16em] text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-400" />LIVE</span>
          <span className="hidden h-4 w-px bg-border sm:block" />
          <button className="text-[9px] font-semibold tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground" aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>{resolvedTheme === "dark" ? "LIGHT" : "DARK"}</button>
          <button className="text-[9px] font-semibold tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40" onClick={signOut} disabled={loggingOut}>{loggingOut ? "EXITING" : "SIGN OUT"}</button>
        </div>
      </header>
      <main className="page-enter mx-auto w-full max-w-[1560px] px-5 py-9 sm:px-9 sm:py-12 xl:px-14">{children}</main>
    </div>
  </div>
}
