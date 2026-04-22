FROM node:20-alpine
RUN apk add --no-cache openssl netcat-openbsd chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "until nc -z postgres 5432; do echo 'waiting for postgres...'; sleep 2; done && npx prisma db push --accept-data-loss && node dist/index.js"]
