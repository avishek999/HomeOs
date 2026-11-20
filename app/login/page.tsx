import { redirect } from "next/navigation"
import { getValidSession, authIsConfigured } from "@/lib/auth/session"
import { LoginBrand, LoginForm } from "@/components/dashboard/login-form"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  if (await getValidSession()) redirect("/dashboard")
  return <main className="grid min-h-svh bg-background lg:grid-cols-[1.12fr_0.88fr]">
    <section className="relative hidden min-h-svh flex-col justify-between overflow-hidden border-r border-border/70 bg-[#08090a] px-12 py-10 text-white lg:flex xl:px-[8vw] xl:py-14">
      <div className="absolute inset-0 login-grain" />
      <div className="relative z-10"><LoginBrand /><p className="mt-1.5 text-[8px] tracking-[0.24em] text-white/45">PRIVATE SYSTEMS</p></div>
      <div className="relative z-10 max-w-[620px]">
        <p className="eyebrow mb-6 text-primary">YOUR SERVER · AT A GLANCE</p><h1 className="text-[clamp(3.5rem,7vw,7.25rem)] leading-[0.88] font-medium tracking-[-0.075em]">Quiet<br />control<span className="text-primary">.</span></h1><p className="mt-8 max-w-[380px] text-[13px] leading-6 text-white/55">A private window into the systems, storage, and uptime that keep your home server running.</p>
      </div>
      <div className="relative z-10 flex items-center gap-3 text-[8px] font-medium tracking-[0.18em] text-white/45"><span className="size-1.5 rounded-full bg-emerald-400" />PRIVATE · SINGLE-USER ACCESS</div>
    </section>
    <section className="flex min-h-svh items-center justify-center px-6 py-12 sm:px-12">
      <div className="w-full max-w-[370px]"><div className="mb-16 lg:hidden"><LoginBrand /><p className="mt-1.5 text-[8px] tracking-[0.24em] text-muted-foreground">PRIVATE SYSTEMS</p></div><div className="mb-10"><p className="eyebrow mb-4">OWNER ACCESS</p><h2 className="text-[30px] leading-none font-medium tracking-[-0.055em]">Welcome home.</h2><p className="mt-3 text-[12px] text-muted-foreground">Authenticate to continue to your server.</p></div><LoginForm configured={authIsConfigured()} /><p className="mt-10 border-t border-border/70 pt-4 text-[8px] leading-5 tracking-[0.1em] text-muted-foreground">PRIVATE SESSION · ENCRYPTED · OWNER ONLY</p></div>
    </section>
  </main>
}
