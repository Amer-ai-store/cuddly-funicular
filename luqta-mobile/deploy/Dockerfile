# Luqta commerce server — zero npm dependencies (Node 24 built-ins: http, sqlite, crypto).
# Build from the luqta-mobile folder:  docker build -f deploy/Dockerfile -t luqta-server .
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 COMMERCE_DB=/data/commerce.sqlite
WORKDIR /app
COPY server/*.mjs server/catalog.json ./server/
COPY server/modules/ ./server/modules/
RUN addgroup -S luqta && adduser -S luqta -G luqta && mkdir -p /data && chown luqta:luqta /data
USER luqta
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/ready || exit 1
CMD ["node", "--no-warnings", "server/commerce.mjs"]
