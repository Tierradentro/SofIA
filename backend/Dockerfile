FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# OCR local embebido (M13/HU-018): Tesseract + Poppler para PDF escaneado
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa poppler-utils
ENV OCR_TESS_LANGS=spa+eng
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main"]
