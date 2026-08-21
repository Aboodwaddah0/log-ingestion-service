# ---- build stage ----
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# tsc emits .js only. migrate.ts resolves MIGRATIONS_DIR relative to its own
# compiled location (dist/db/migrations), so the .sql files have to be copied
# in explicitly — without this, startup fails with ENOENT on the first run.
RUN cp -r src/db/migrations dist/db/migrations

# ---- runtime stage ----
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/server.js"]
