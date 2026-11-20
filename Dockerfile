# Multi-stage Dockerfile for Google Cloud Run
# Optimized for: Node.js 20, SQLite (better-sqlite3), WebSocket, React/Vite build

# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install build dependencies for better-sqlite3 (native module)
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY bun.lock* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build frontend (Vite) - outputs to dist/
RUN npm run build

# ─── Production Stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache sqlite-libs

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server source (TypeScript) - we'll run with tsx
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy data directory structure (SQLite will be created at runtime)
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Copy .env.example as template (will be overridden by Cloud Run env vars)
COPY --from=builder /app/.env.example ./.env.example

# Switch to non-root user
USER nodejs

# ─── Runtime Configuration ───────────────────────────────────────────────────
# Cloud Run injects PORT env var (default 8080)
# We map our app's PORT to Cloud Run's PORT
ENV PORT=8080
ENV NODE_ENV=production

# Expose port (Cloud Run expects 8080)
EXPOSE 8080

# Health check endpoint (Cloud Run uses this for readiness)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# ─── Start Command ───────────────────────────────────────────────────────────
# Use tsx to run TypeScript directly (avoids separate compile step)
# tsx is in production deps via package.json
CMD ["npx", "tsx", "server.ts"]