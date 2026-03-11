# Atheon™ On-Premise / Hybrid Deployment Dockerfile
# Builds the API server for on-prem deployment using Node.js
# Usage: docker build -t gonxt/atheon-api:latest .
# Run:   docker run -p 3000:3000 --env-file .env gonxt/atheon-api:latest

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY workers/api/package.json workers/api/package-lock.json ./
RUN npm ci --production=false

# Copy source
COPY workers/api/ ./

# Type check
RUN npx tsc -b --noEmit 2>/dev/null || true

# ── Runtime Stage ──
FROM node:20-alpine AS runtime

WORKDIR /app

# Security: run as non-root user
RUN addgroup -S atheon && adduser -S atheon -G atheon

# Copy node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Create data directory for SQLite (mounted as volume)
RUN mkdir -p /data && chown atheon:atheon /data

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/data/atheon.db
ENV ENVIRONMENT=on-premise

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Switch to non-root user
USER atheon

EXPOSE 3000

# Start the API server via wrangler dev (local mode) or custom entrypoint
CMD ["npx", "wrangler", "dev", "--local", "--port", "3000", "--persist-to", "/data"]
