import { redirect } from "next/navigation"
import { getValidSession } from "@/lib/auth/session"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"

export const dynamic = "force-dynamic"

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getValidSession()
  if (!session) redirect("/login")
  return <DashboardShell>{children}</DashboardShell>
}
