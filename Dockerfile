FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libheif-examples && rm -rf /var/lib/apt/lists/*
RUN chown 1000:1000 /app
USER 1000:1000
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci
COPY --chown=1000:1000 . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends libheif-examples && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOMEOS_DB_PATH=/var/lib/homeos/homeos.sqlite \
    HOMEOS_DATA_ROOT=/mnt/homeos-data
WORKDIR /app
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/scripts/start-production.mjs ./scripts/start-production.mjs
COPY --from=builder --chown=1000:1000 /app/lib/server/production-preflight.mjs ./lib/server/production-preflight.mjs
RUN mkdir -p /var/lib/homeos /mnt/homeos-data && chown 1000:1000 /var/lib/homeos /mnt/homeos-data
USER 1000:1000
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
