# HomeOS roadmap

## Phase 1 — Server dashboard (complete)
- Responsive, text-led dashboard with collapsible navigation and dark/light themes.
- Single-user password authentication; protected pages and APIs.
- CPU, memory, storage, hostname and uptime metrics; macOS development uses labeled mock data.
- Read-only browser rooted at `/mnt/storage`, with traversal and symlink checks.

## Phase 2 — Personal media and storage (implemented)
- Separate managed writable volume for cloud uploads, previews, deployments and backup snapshots. Existing `/mnt/storage` stays read-only.
- Authenticated upload/list/download with size and quota limits, unique names, and no overwrite.
- Photos and movie browser, authenticated media delivery, and byte-range video playback.
- HEIC/HEIF images convert on demand to JPEG previews; originals remain unchanged. The Compose image includes Debian's `libheif-examples` decoder and Sharp bounds the generated preview to 2,400 pixels per side. Inputs above 100 MB and decoded images above 100 megapixels are rejected.

## Phase 3 — Services and deployments (implemented)
- Docker inventory, bounded/redacted logs and start/stop/restart for containers explicitly labeled `com.homeos.managed=true`.
- Docker socket exists only in a separate helper. HomeOS can reach it over an internal Compose network with a random bearer secret; the browser never receives the socket or secret.
- GitHub deployments accept only an explicit repository/ref/port allow-list and a fine-grained read-only token. Source size and file count are bounded; symlinks/submodules are rejected.
- Public app containers receive no HomeOS mounts or credentials, run as UID 1000 with read-only root, dropped capabilities and resource limits, and publish only to loopback.
- Deployment history is stored in SQLite.

## Phase 4 — Databases, automation and backups (implemented)
- SQLite status/integrity/table inventory plus checkpoint and VACUUM operations; arbitrary SQL is not exposed.
- Daily UTC backup scheduler, manual snapshots, run history, retention and quota controls.
- Snapshots include the HomeOS SQLite database and managed uploads, run SQLite integrity checks, and include SHA-256 checksums with an authenticated verification action.
- Backups stay on the separate managed volume. Restore is intentionally an operator procedure: verify a snapshot, stop HomeOS, preserve the current state, then restore the database/uploads from the snapshot before restarting.

## Deployment validation status
- Automated checks: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:smoke`.
- Container readiness: validate with `docker compose config`, build the two images and exercise deployment/backup flows on the target Linux host before exposing the loopback service through a private HTTPS proxy or VPN.
- HomeOS must run unprivileged. Do not point writable mounts at `/mnt/storage`, expose the helper, publish HomeOS directly to the internet, or give deployed apps access to private volumes/secrets.
