FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Motor OCR local del servicio independiente (M13)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa poppler-utils
ENV OCR_TESS_LANGS=spa+eng
ENV PORT=3100
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3100
CMD ["node", "dist/index.js"]
