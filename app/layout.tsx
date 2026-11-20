import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { QueryProvider } from "@/components/dashboard/query-provider"

export const metadata: Metadata = {
  title: "HomeOS · Server console",
  description: "A private, at-a-glance dashboard for your home server.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><ThemeProvider><QueryProvider>{children}</QueryProvider></ThemeProvider></body></html>
}
