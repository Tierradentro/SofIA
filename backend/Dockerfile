FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Se poda devDependencies aquí para que el runtime copie los node_modules
# ya listos en vez de correr un segundo `npm ci` (ese paso doble disparaba
# el bug intermitente de npm "Exit handler never called!" bajo la carga de
# builds paralelos en EasyPanel).
RUN npm run build && npm prune --omit=dev

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
