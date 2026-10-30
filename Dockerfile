ARG PG_MAJOR=17

# --- Stage 1: build the dashboard (web/, jimbo.ui: React + Tailwind) ---------
# Only this stage needs npm. Its output is static files; nothing from
# node_modules reaches the final image.
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# The jimbo-ui config section's About tab shows this app's jimbo-ui.json.
COPY jimbo-ui.json /jimbo-ui.json
RUN npm run build

# --- Stage 2: the backup container -------------------------------------------
FROM node:22-bookworm-slim
ARG PG_MAJOR

# rsync + a Postgres client + jq (state.json) + tzdata (America/Toronto).
# We pull the client from PGDG rather than Debian's default so it is NEWER than
# whatever Immich's Postgres is: pg_dump can always dump an older server, never
# a newer one. Bump PG_MAJOR only if Immich ever outruns this.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg rsync jq tzdata procps; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}"; \
    apt-get purge -y --auto-remove gnupg; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The server is Node standard library only: no npm install in this stage, no
# node_modules to go stale. Once built, nothing here needs the internet — the
# dashboard ships its own fonts and CSS.
COPY scripts/ /app/scripts/
COPY app/ /app/app/
COPY --from=web /web/dist/ /app/app/public/
RUN chmod +x /app/scripts/*.sh

EXPOSE 4343

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
