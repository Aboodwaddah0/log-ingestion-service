FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && cp -r src/db/migrations dist/db/migrations

RUN npm prune --omit=dev

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
