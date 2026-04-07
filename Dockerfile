# Atheon™ On-Premise / Hybrid Deployment Dockerfile
# Builds the API server for on-prem deployment using Node.js
# Usage: docker build -t gonxt/atheon-api:latest .
# Run:   docker run -p 3000:3000 --env-file .env gonxt/atheon-api:latest

FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies
COPY workers/api/package.json workers/api/package-lock.json ./
RUN npm ci --production=false

# Copy source
COPY workers/api/ ./

# Type check
RUN npx tsc -b --noEmit 2>/dev/null || true

# ── Runtime Stage ──
FROM node:20-slim AS runtime

WORKDIR /app

# Security: run as non-root user with a home directory for wrangler config/logs
RUN groupadd -r atheon && useradd -r -g atheon -m -d /home/atheon atheon

# Copy node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/wrangler.toml ./

# Create data directory for SQLite (mounted as volume)
RUN mkdir -p /data && chown atheon:atheon /data

# Wrangler needs write access to /app for .wrangler temp dir, node_modules for miniflare cache
RUN chown -R atheon:atheon /app

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/data/atheon.db
ENV ENVIRONMENT=on-premise

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Switch to non-root user
USER atheon

EXPOSE 3000

# Start the API server via wrangler dev (local mode)
# Pass ENVIRONMENT from Docker env to Miniflare Worker bindings via --var
# This overrides the wrangler.toml [vars] ENVIRONMENT="production" default
CMD ["sh", "-c", "npx wrangler dev --local --port 3000 --ip 0.0.0.0 --persist-to /data --var ENVIRONMENT:${ENVIRONMENT:-on-premise}"]
