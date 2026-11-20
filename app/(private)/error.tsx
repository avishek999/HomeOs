"use client"

import { Button } from "@/components/ui/button"

export default function PrivateError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center text-center"><h1 className="text-lg font-semibold">Something went wrong</h1><p className="mt-1 max-w-md text-sm text-muted-foreground">{error.message || "The dashboard could not load this section."}</p><Button className="mt-4" variant="outline" onClick={() => retry()}>Try again</Button></div>
}
