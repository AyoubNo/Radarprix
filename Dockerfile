FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PRIXRADAR_API_HOST=0.0.0.0 \
    PRIXRADAR_API_PORT=3500 \
    PRIXRADAR_DATA_DIR=/data \
    CHROMIUM_PATH=/usr/bin/chromium

VOLUME ["/data"]
EXPOSE 3500
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3500/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "start:api"]
