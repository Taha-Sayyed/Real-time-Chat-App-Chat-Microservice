# syntax=docker/dockerfile:1

# --------------------------
# Build argument for Node version
# --------------------------
ARG NODE_VERSION=22

# ==============================
# Stage 1: Production Dependencies
# ==============================
FROM node:${NODE_VERSION}-alpine AS deps-prod

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && \
    npm cache clean --force

# ==============================
# Stage 2: Build
# ==============================
FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci && \
    npm cache clean --force

COPY . .

RUN npm run build

# ==============================
# Stage 3: Runtime
# ==============================
FROM node:${NODE_VERSION}-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5002

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy only the artifacts required to run the service
# NOTE: package.json is REQUIRED because it contains "type": "module"
COPY --from=deps-prod --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

# Apply restrictive read-only permissions
RUN chmod -R 555 /app/dist /app/node_modules && \
    chmod 444 /app/package.json

USER nodejs

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node --eval "require('http').get('http://127.0.0.1:5002/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]