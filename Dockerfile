# --- Stage 1: Install dependencies ---
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/
RUN bun install

# --- Stage 2: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY . .
RUN bun run --cwd packages/web build

# --- Stage 3: Runtime ---
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7019

# Copy built assets and dependencies
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

EXPOSE 7019

CMD ["bun", "packages/web/server.js"]
