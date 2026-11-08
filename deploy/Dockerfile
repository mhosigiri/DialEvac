# Build from the repository root: clients and services import ../shared and ../spacetimedb.
#   docker build -f deploy/Dockerfile --target web -t dialevac-web .
#   docker build -f deploy/Dockerfile --target services -t dialevac-services .
FROM node:22-bookworm-slim AS bindings
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://install.spacetimedb.com -o /tmp/install-spacetime.sh \
  && sh /tmp/install-spacetime.sh --yes \
  && /root/.local/bin/spacetime version install 2.14.1 --use --yes
ENV PATH=/root/.local/bin:$PATH
WORKDIR /repo
COPY shared shared
COPY spacetimedb spacetimedb
RUN npm ci --prefix spacetimedb
RUN spacetime generate --lang typescript --out-dir /bindings --module-path spacetimedb --no-config

FROM bindings AS web-build
# Vite writes these into the bundles, so changing one requires a rebuild.
ARG VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com
ARG VITE_SPACETIME_DATABASE=hackutd-richardson
ARG VITE_MAP_URL=/map/index.html
COPY dispatchers-portal dispatchers-portal
COPY driver driver
COPY map map
RUN for app in dispatchers-portal driver map; do \
    cp -r /bindings "$app/src/module_bindings" \
    && npm ci --prefix "$app" \
    && npm run build --prefix "$app" || exit 1; \
  done

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /repo/dispatchers-portal/dist /srv
COPY --from=web-build /repo/driver/dist /srv/driver
COPY --from=web-build /repo/map/index.html /srv/map/index.html
COPY --from=web-build /repo/map/assets /srv/map/assets
EXPOSE 8080

FROM bindings AS services-build
COPY services services
RUN cp -r /bindings services/src/module_bindings && npm ci --omit=dev --prefix services
RUN mkdir -p services/.spacetime

FROM node:22-bookworm-slim AS services
ENV NODE_ENV=production
WORKDIR /app
COPY --from=services-build /repo/shared shared
COPY --from=services-build /repo/spacetimedb/src/domain spacetimedb/src/domain
COPY --chown=node:node --from=services-build /repo/services services
WORKDIR /app/services
USER node
EXPOSE 8080
CMD ["npm", "run", "-s", "voice"]
