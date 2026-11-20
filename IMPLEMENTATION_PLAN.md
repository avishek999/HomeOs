# HomeOS implementation plan

## Modular architecture
- `app/(private)` contains pages behind the server-side session guard.
- `app/api` contains authenticated route handlers with same-origin checks on mutations.
- `lib/auth` handles password verification, opaque cookie sessions and login throttling.
- `lib/db` owns SQLite/Drizzle setup, schema and bounded administrative operations.
- `lib/system` and `lib/storage` provide host metrics, read-only `/mnt/storage` access and managed-volume writes.
- `lib/backups` owns snapshots, checksum verification, retention and the daily UTC scheduler.
- `lib/deployments` validates GitHub allow-lists, downloads bounded source trees and records history.
- `lib/services/docker.ts` talks to the isolated Docker helper; `docker-helper/server.mjs` is the only service with the Docker socket.
- `components/dashboard` provides the responsive text-led navigation and feature consoles.

## Security and operations
- Run HomeOS and deployed applications as non-root users.
- Mount `/mnt/storage` read-only. Uploads, generated data, deployment sources and backups use the separate `HOMEOS_DATA_ROOT` volume; SQLite uses a separate state volume.
- Validate sessions on every private endpoint; reject traversal and symlink escapes.
- Expose no general shell or SQL execution interface. Docker operations use a fixed allow-list and managed-container label.
- Keep the Docker helper on an internal network. Do not expose its bearer secret to the browser or mount the socket in the HomeOS web service.
- Deploy only explicit GitHub repository/ref/port entries with a fine-grained read-only token. Public app containers have no HomeOS volumes or secrets.
- Use backups on an isolated destination and verify checksums and SQLite integrity. Recovery is a documented operator procedure.

## Validation sequence
1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run test:smoke`
5. On the target Linux host, validate `docker compose config`, build the HomeOS and helper images, run container and helper checks, perform one allow-listed deployment, and rehearse backup restore.

The local environment cannot prove host Docker behavior unless its Docker Engine is running. Keep the deployment private behind a VPN or authenticated HTTPS reverse proxy.
