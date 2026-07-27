# SofIA Logística Inteligente

WMS multiempresa (IRE e ICV) — monorepo.

## Estructura

```
sofia/
├── backend/        NestJS + TypeORM + PostgreSQL (API /api/v1)
├── frontend/       Next.js + TypeScript + Tailwind
├── ocr-worker/     Servicio OCR independiente (esqueleto; lógica en I5)
├── nginx/          Proxy inverso
└── docker-compose.yml
```

## Arranque con Docker (Spec §9)

```bash
docker compose up --build
```

- Aplicación: http://localhost:8080 (nginx → frontend/backend)
- API: http://localhost:8080/api/v1 (health: `/api/v1/health`)
- Usuario inicial: **Admin / Admin** (cambio de clave obligatorio en el primer login, M02/M14)
- El backend corre migraciones y semillas al arrancar (empresas IRE/ICV,
  parámetros del sistema, catálogo de motivos PQRS G01–G40/N01–N18).

## Desarrollo local del backend

```bash
cd backend
cp .env.example .env          # ajusta DB_HOST=localhost
npm install
npm run migration:run         # crea esquema
npm run seed                  # semillas I0
npm run start:dev
```

## Pruebas

```bash
cd backend
npm test                      # unitarias (16)
npm run test:e2e              # e2e contra PostgreSQL real (25)
```

Las e2e esperan un PostgreSQL accesible (variables `TEST_DB_*` o
`127.0.0.1:5433` con usuario `sofia_app/sofia_secret` y rol `postgres` sin
clave). La suite crea/destruye la base `sofia_test` en cada archivo.

## Reglas transversales implementadas (I0–I1)

- RBAC enforceado en backend con guards globales (JWT → Roles), nunca solo en frontend.
- Auditoría append-only a nivel de BD (trigger `BEFORE UPDATE OR DELETE`);
  purga administrativa con exportación CSV previa obligatoria y auto-auditoría (A-03).
- Política de claves parametrizable (M02): mínimo 6, mayúsculas/minúsculas/números,
  expiración 60 días, bloqueo a los 5 intentos; cambio obligatorio en primer login.
- Recuperación de contraseña por reseteo del Administrador con clave temporal (P-07).
- Multiempresa genérico (A-01): N empresas; IRE/ICV son solo el seed inicial.
- Siglas de empresa obligatorias para el consecutivo de pedido `SIGLAS-####` (P-09).

## Estado del proyecto

Iteración actual: **I0 + I1 (MVP)** — cimientos, autenticación, usuarios,
empresas, RBAC y auditoría. Ver plan de ejecución para las iteraciones
siguientes (I2 administración → I11 API externa).
