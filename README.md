# HomeOS

HomeOS is a private, single-user server console for host health, read-only media browsing, managed cloud uploads, Docker controls, GitHub deployments and verified backups. It uses high contrast, oversized system typography, fine separators and text navigation, taking cues from the supplied [Shadboard analytics reference](https://shadboard.vercel.app/en/dashboards/analytics). The UI uses no decorative icons.

## Stack

- Next.js App Router, TypeScript, and Tailwind CSS 4
- shadcn/ui components with a text-led visual system
- SQLite with Drizzle ORM for session and login-throttle state
- TanStack Query for live polling
- Recharts for the CPU and memory history chart
- systeminformation for live Node/Linux metrics
- sharp for bounded on-demand HEIC/HEIF JPEG previews

The dashboard polls every four seconds. On macOS development, HomeOS serves clearly labeled mock metrics and a mock storage listing; it never reads `/mnt/storage` there.

The Photos and Movies pages browse existing media read-only under `/mnt/storage`. Media responses require a valid session; movies support byte ranges for seeking. HEIC/HEIF files are converted on demand to bounded JPEG previews. Originals remain unchanged. The supplied Linux image includes `libheif-examples`; non-container Linux installs need `heif-convert` on `PATH`.

Cloud uploads are stored in a separate managed volume. Set `HOMEOS_DATA_ROOT` to an absolute path on a dedicated mounted volume outside `/mnt/storage`, and mount it writable only by the unprivileged HomeOS account. Uploads are limited to 25 MB each and use unique names (no overwrite); the default total quota is 10 GiB and can be changed with `HOMEOS_STORAGE_QUOTA_BYTES`. Without this configuration, uploads remain disabled.

Transitions use CSS and respect `prefers-reduced-motion`. Motion 14.14.0 was requested, but the package could not be installed here because registry access is denied; the UI currently uses CSS transitions.

## Local setup

Use a supported Node.js release (Node 24 was used for this scaffold). Install packages from the project directory:

```sh
npm install
```

Create the one-user password hash:

```sh
node scripts/create-password-hash.mjs
```

Copy `.env.example` to `.env.local`, set the generated `HOMEOS_PASSWORD_HASH`, and set a private session secret. On macOS, generate the session secret with `openssl rand -hex 32`. Keep `.env.local` and all secrets out of Git.

```sh
npm run dev
```

The app will show a setup notice until both the password hash and a session secret of at least 32 characters are present.

## Production notes

- `npm start` checks auth secrets and a mounted writable `HOMEOS_DATA_ROOT` outside `/mnt/storage`, and refuses UID 0. In Compose, HomeOS runs as UID/GID 1000.
- The included `Dockerfile` and `docker-compose.yml` build a standalone production image with a read-only container filesystem, dropped Linux capabilities, and the existing storage volume mounted read-only. The web service binds to `0.0.0.0:3010`; place it behind a private HTTPS reverse proxy or VPN.
- Prepare three paths before deployment: the existing `/mnt/storage` data mount, a dedicated writable `/mnt/homeos-data` volume for uploads, and a private writable `/mnt/homeos-state` path for SQLite state. Make the latter two writable by UID/GID 1000. Do not point either writable path at `/mnt/storage`.
- Copy `.env.example` to `.env.production`, set the password hash and random secrets, then run `docker compose --env-file .env.production config --quiet`, `docker compose --env-file .env.production build`, and `docker compose --env-file .env.production up -d`. Keep `.env.production` private and out of Git.
- Login sessions require HTTPS by default. For short-term testing on a trusted private network only, set `HOMEOS_COOKIE_SECURE=false` in `.env.production`; switch it back to `true` before exposing HomeOS beyond that network.
- For local non-container production, set the same variables and run `npm run build && npm start`; the startup preflight requires the data volume to exist and be writable.
- Keep the dashboard on a private network or behind a trusted VPN and HTTPS reverse proxy. Do not publish it as a public website.
- Set `HOMEOS_DB_PATH` to a private writable location for SQLite. The default is `.homeos/homeos.sqlite` in the app directory; HomeOS applies restrictive POSIX permissions where supported. The database is explicitly blocked from `/mnt/storage` so HomeOS never writes to the userâ€™s storage volume.
- Mount the server volume at `/mnt/storage` and grant the unprivileged HomeOS account read and directory-traversal access only.
- The file browser lists directory and file metadata only. It has no write, delete, rename, download, or shell execution endpoint.
- The Docker socket is mounted only into the isolated `docker-helper` service. Keep that helper on the internal Compose network, use a unique 32-character helper secret, and never publish its port.
- GitHub deployment is disabled unless `HOMEOS_GITHUB_TOKEN` and `HOMEOS_GITHUB_REPOSITORIES` are configured. Use a fine-grained token limited to read-only Contents access for only the listed repositories.
- Use the provided `.env.example` as a starting point. Secrets belong in the service manager's protected environment configuration.

### Linux host setup

Run Compose from the HomeOS project directory. First mount a dedicated writable volume at `/mnt/homeos-data` and a private writable state directory or volume at `/mnt/homeos-state`. Confirm both resolve to the intended locations with `findmnt -T /mnt/homeos-data` and `findmnt -T /mnt/homeos-state`. Do not use `/mnt/storage` for either path, and do not change ownership or permissions on `/mnt/storage`.

Create the two HomeOS directories on their mounted volumes and grant only those directories to the Compose account (UID/GID 1000):

```sh
sudo mkdir -p /mnt/homeos-data /mnt/homeos-state
sudo chown 1000:1000 /mnt/homeos-data /mnt/homeos-state
sudo chmod 700 /mnt/homeos-data /mnt/homeos-state
```

Copy `.env.example` to `.env.production`. Generate the password hash with `node scripts/create-password-hash.mjs`, and generate separate secrets with `openssl rand -hex 32` for `HOMEOS_SESSION_SECRET` and `HOMEOS_DOCKER_HELPER_SECRET`. Set `DOCKER_GID` to the group ID printed by `stat -c '%g' /var/run/docker.sock`, keep `HOMEOS_GITHUB_REPOSITORIES=[]` if deployments are not configured, and protect the file with `chmod 600 .env.production`.

Validate and launch with the same env file so Compose can resolve its required secrets:

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
```

HomeOS binds to `127.0.0.1:3010`; keep it behind a private VPN or an authenticated HTTPS reverse proxy. The helper has no published port.

## Security behavior

- Private pages redirect to sign-in, and each private API checks the server-side session independently.
- The session cookie is opaque, HttpOnly, SameSite=Strict, and Secure in production. The database stores only its SHA-256 digest and expiry.
- Passwords are scrypt hashes configured outside the source tree. Failed login attempts are throttled in SQLite.
- Storage paths are relative to `/mnt/storage`. Traversal, absolute paths, symlinks, and resolved paths outside the root are rejected.
- Live system metrics run only on the Node.js server and are never exposed to unauthenticated clients.
- Deployed app containers receive no HomeOS mounts or secrets and run with a read-only root, no Linux capabilities and resource limits. Only configured loopback ports are published.
- Database controls expose SQLite inventory, integrity and two maintenance operations; arbitrary SQL is unavailable. Backups use a separate managed volume and provide checksummed verification.

## Validation

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:smoke`. Before deployment, validate `docker compose --env-file .env.production config --quiet`, build both images and exercise the helper, GitHub build and restore procedure on the target Linux Docker host. Docker Engine is not available in this development environment, so host-level container deployment cannot be verified here.

## Project docs

- [AGENTS.md](./AGENTS.md) â€” implementation and security rules.
- [ROADMAP.md](./ROADMAP.md) â€” product phases and completion criteria.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) â€” architecture, delivery order, and acceptance checks.
#
