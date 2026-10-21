FROM node:22-alpine AS build
WORKDIR /app
# pnpm en lugar de npm: `npm ci` moría de forma intermitente en EasyPanel con
# "npm error Exit handler never called!" (bug conocido de npm bajo carga de
# builds paralelos). pnpm tiene un modo de red mucho más liviano y no lo
# sufre. corepack ya viene con node:22-alpine.
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Se poda devDependencies aquí para que el runtime copie los node_modules ya
# listos (sin una segunda instalación de dependencias).
RUN pnpm run build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# OCR local embebido (M13/HU-018): Tesseract + Poppler para PDF escaneado
# I49: tini como init (mismo motivo que el frontend): reapa zombies del
# healthcheck ejecutado por docker exec y reenvía señales a node.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa poppler-utils tini
ENV OCR_TESS_LANGS=spa+eng
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
