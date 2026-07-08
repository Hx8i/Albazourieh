# Albazourieh — Post-War Damage Assessment & Recovery Platform

A platform that helps Lebanese municipalities manage post-war damage
assessments:

- **Citizen wizard** (`frontend`, Arabic-first): the public root URL *is*
  the 7-step reporting wizard — no navigation to any admin tooling.
  Category-aware flows (property/land vs. car/motorcycle) with
  conditional documents (national ID, residency proof, rental contract
  for tenants, vehicle registration + photos), a 45-second voice
  recorder with countdown, dual-mode location (GPS or pin-drop map),
  live property-number uniqueness checking, and one single
  multipart/form-data submission carrying payload + all files.
- **Municipality portal** (`frontend`): lives on a **hidden path**
  (`/​{locale}/admin-portal-x7b2`; the guessable `/dashboard` path is
  hard-404'd in middleware). JWT staff login, a **deck.gl damage map of
  Al Bazourieh**, cached status counters, a **server-paginated** report
  table with evidence viewer, case-file audit pages, status workflow and
  CSV export.
- **API** (`backend`): NestJS + Prisma + Zod over Supabase PostgreSQL.
  Multipart media pipeline (FileFieldsInterceptor → content-sniffed →
  Supabase Storage), discriminated-union validation per category,
  property-number uniqueness enforced inside the submission transaction,
  and an in-memory TTL cache (5 min) for dashboard aggregates that is
  cache-busted instantly on every submission or status change.

## Repository layout

```
backend/    NestJS API (Clean Architecture: Controller → Service → Repository → Prisma)
  prisma/schema.prisma        Full database design (+ district/status/geo indexes)
  prisma/seed.cjs             Seeds the first staff account (pnpm run seed)
  src/auth/                   JWT login for MunicipalityUser + JwtAuthGuard
  src/uploads/                Photo/voice pipelines → damage-photos & voice-notes buckets
  src/damage-report/          DTOs (Zod), controller, service, repository (incl. /spatial)
  src/common/                 Zod pipe, domain errors, global exception filter
  src/health/                 GET /health liveness + DB check
frontend/   Next.js 15 App Router + TailwindCSS + shadcn/ui + deck.gl/MapLibre
  app/[locale]/               en/ar routes: landing, /report, /dashboard, /dashboard/reports/[id]
  components/citizen/         CitizenWizardForm.tsx (elderly-first, dual-mode location)
  components/dashboard/       StaffGate, MunicipalityDashboard, DamageMapPanel, ReportDetailView
  components/map/             Shared map config + LocationPickerMap (pin drop)
  lib/i18n/dictionaries.ts    English + Arabic translations (compiler-enforced parity)
```

## 1. Prerequisites

- Node.js ≥ 20, pnpm
- A Supabase project (free tier is fine)

## 2. Backend setup

```bash
cd backend
cp .env.example .env       # fill in every value (see table below)
pnpm install
pnpm run prisma:generate
pnpm run prisma:migrate    # creates all tables, enums and indexes
pnpm run seed              # creates the first staff login
pnpm run start:dev         # API on http://localhost:4000/api/v1
```

| `.env` variable | Purpose |
| --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres. `DATABASE_URL` **must** keep `connection_limit=1` behind the transaction-mode pooler (port 6543). |
| `JWT_SECRET` | Signs staff JWTs (12h expiry). The server refuses to boot without it. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First dashboard account, created by `pnpm run seed`. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Server-side storage uploads. Buckets `damage-photos` (≤5MB images) and `voice-notes` (≤10MB audio) are auto-created on boot. Without the key, uploads 503 gracefully and reports still submit. |

Endpoints:

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Anyone | Liveness + DB connectivity |
| POST | `/api/v1/auth/login` | Staff | Email+password → JWT (throttled 5/min) |
| POST | `/api/v1/damage-reports/multipart` | Citizen | **Primary submission**: payload JSON + all raw files in one multipart request |
| GET | `/api/v1/properties/validate-number?number=…` | Citizen | Property-number uniqueness blur-check |
| POST | `/api/v1/uploads/photo` \| `voice` \| `document` | Citizen | Standalone validated upload → public URL |
| POST | `/api/v1/damage-reports` | Citizen | Legacy JSON submission (pre-uploaded URLs) |
| GET | `/api/v1/damage-reports` | Staff (JWT) | Paginated inbox (`totalCount`/`totalPages`/`currentPage`) |
| GET | `/api/v1/damage-reports/summary` | Staff (JWT) | Dashboard counters |
| GET | `/api/v1/damage-reports/spatial` | Staff (JWT) | Minimal deck.gl point payload |
| GET | `/api/v1/damage-reports/:id` | Staff (JWT) | Full case file |
| PATCH | `/api/v1/damage-reports/:id/status` | Staff (JWT) | Lifecycle transition (reviewer recorded from JWT) |

Review lifecycle (enforced server-side):
`PENDING → UNDER_REVIEW → VERIFIED → APPROVED`, with `REJECTED`
reachable from any non-terminal state (rejection reason mandatory).

## 3. Frontend setup

```bash
cd frontend
cp .env.example .env.local   # just NEXT_PUBLIC_API_URL
pnpm install
pnpm run dev                 # http://localhost:3000 → redirects to /ar or /en
```

The dashboard (`/dashboard` and every case-file page) renders a staff
login form until a valid JWT session exists; any expired token logs the
session out automatically. Maps use MapLibre with free CARTO basemaps —
no Mapbox token or any other client-side secret is required.

## 4. Security model

- **Staff auth is real JWT auth** against the `MunicipalityUser` table
  (bcrypt-hashed passwords, roles `SUPER_ADMIN`/`AUDITOR`/`FIELD_INSPECTOR`,
  `isActive` kill-switch, 12h expiry, brute-force throttling on login).
- **Media uploads** are validated server-side: size ceilings (5MB photos,
  10MB audio), MIME allowlists, and **magic-number content sniffing** so a
  renamed executable can't pass as an image. Storage writes use a
  service-role key that never reaches the browser.
- **Evidence URLs** in submissions must be `https://` **and** point at this
  project's own storage buckets — foreign URLs are rejected (422).
- **Rate limiting**: global 120/min, submissions 10/min, uploads 20/min,
  login 5/min. Plus `helmet` headers and gzip compression.
- **Audit trail**: every status change records the acting staff member
  (`reviewedById`) from their verified JWT — not from client input.

## 5. Notes for the next iteration

- **Citizen OTP login**: the `User` model already carries `otpCode` /
  `otpExpiresAt`; wire an SMS provider (e.g. Twilio Verify).
- **Role-based permissions**: guard is in place; add per-role checks
  (e.g. only `SUPER_ADMIN` approves, `FIELD_INSPECTOR` files
  `InspectionLog` entries with estimated costs).
- **Inspections**: `InspectionLog` (visit date, structural notes,
  estimated cost USD, confirmed severity) is modeled and ready for a
  field-inspector flow.
