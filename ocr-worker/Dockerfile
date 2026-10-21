FROM node:22-alpine AS build
WORKDIR /app
# pnpm en lugar de npm: `npm ci` moría de forma intermitente en EasyPanel con
# "npm error Exit handler never called!" (bug conocido de npm). corepack ya
# viene con node:22-alpine.
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Motor OCR local del servicio independiente (M13)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa poppler-utils
ENV OCR_TESS_LANGS=spa+eng
ENV PORT=3100
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 3100
CMD ["node", "dist/index.js"]
