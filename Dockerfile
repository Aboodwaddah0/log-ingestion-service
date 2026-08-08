FROM node:22-alpine

WORKDIR /app

COPY package*.json .

RUN npm install

COPY . .

EXPOSE 8080

RUN npm run build && cp -r src/db/migrations dist/db/
CMD ["npm","run","start"]
