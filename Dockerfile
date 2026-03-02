FROM oven/bun:1-slim AS base
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# --- Build widget ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build-widget.ts

# --- Production ---
FROM base
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src ./src
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3334

# Create data directory for checkpoint SQLite DB (must be writable by bun user)
RUN mkdir -p /app/data && chown bun:bun /app/data

USER bun
CMD ["bun", "run", "src/main.ts"]
