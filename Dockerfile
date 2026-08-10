# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY .npmrc package.json package-lock.json* ./
COPY prisma ./prisma
RUN --mount=type=secret,id=NODE_AUTH_TOKEN \
  NODE_AUTH_TOKEN="$(cat /run/secrets/NODE_AUTH_TOKEN)" npm install && npx prisma generate

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server/index.js"]

FROM deps AS dev
WORKDIR /app
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=development
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx watch src/server/index.ts"]
