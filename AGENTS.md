# HomeOS project rules

## Scope
- Build the features in roadmap order; implement and verify one phase at a time.
- Keep `/mnt/storage` read-only. Put all HomeOS-created files, uploads, media derivatives, and backup staging on the separate `HOMEOS_DATA_ROOT` mount.
- Use fail-closed adapters for services that have not been configured. Never imply a disabled integration is working.

## Security
- Never run the app as root. Production startup must fail when the process is UID 0.
- Every private API handler must call the shared session guard before returning data.
- Restrict existing personal files to read-only access under `/mnt/storage`. Reject traversal, absolute paths, and symlinks. New uploads must use `HOMEOS_DATA_ROOT`, never overwrite, and be size/quota limited.
- Never execute arbitrary shell commands or expose the Docker socket.
- Keep authentication secrets in environment variables. Never add credentials to source control.
- Keep personal data out of public deployments. HomeOS is intended to run on a private server.

## Implementation
- Prefer small modules grouped by domain (`lib/auth`, `lib/db`, `lib/system`, `lib/storage`, `lib/media`, `lib/services`, `lib/backups`).
- Keep OS and database work on the Node.js server, never in client components.
- Use the existing Next.js App Router, TypeScript, Tailwind, shadcn/ui, TanStack Query, Recharts, Drizzle, SQLite, and systeminformation setup.
- Keep the HomeOS interface text-led and do not add decorative icons. Use Motion for purposeful transitions when installed and respect reduced-motion preferences.
- Add a dependency only when an implemented feature needs it. Document blocked package installs instead of silently substituting another library.
- Preserve the scaffold's generated Next.js instructions below.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
