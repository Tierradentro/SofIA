FROM node:22-alpine AS build
WORKDIR /app
# NEXT_PUBLIC_* se inyecta en el bundle en tiempo de BUILD (no runtime):
# AJ-002: por defecto es la ruta RELATIVA /api/v1 — el navegador la resuelve
# contra el dominio público HTTPS y nginx la enruta al backend por la red
# interna. Todos los consumos de API del frontend son del lado del cliente.
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# I49: init mínimo. Docker exec'ea el healthcheck en el PID 1 del contenedor;
# sin init, un servidor node como PID 1 no tiene reaper de zombies y un wget
# que no cierra limpio deja procesos <defunct> acumulados — el healthcheck
# termina fallando aunque el servicio responda (fue el "frontend is
# unhealthy" de los despliegues I47/I48). tini reapa zombies y reenvía
# señales (SIGTERM del docker stop llega a node para apagado limpio).
RUN apk add --no-cache tini
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
