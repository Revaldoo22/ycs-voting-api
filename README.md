# ycs-voting-api

NestJS backend for **Youth Character Summit (YCS)** — a school voting event.
Own database + auth (rewrite of the earlier Supabase-based FKP voting backend).

Stack: **NestJS 10** · **TypeORM** (Postgres) · **JWT** (httpOnly cookie) ·
`@nestjs/schedule` (cron) · Express static uploads · optional S3/MinIO & Depot
storage drivers.

Pairs with the admin/public frontend: [`ycs-voting-web`](https://github.com/Revaldoo22/ycs-voting-web).
Integration API for the companion registration app: [`INTEGRASI-API.md`](INTEGRASI-API.md).

---

## Quick start (dev)

Needs a local Postgres with a database named `idola_stekom` (configurable).

```bash
npm install
cp .env.example .env        # then edit values
npm run start:dev           # http://localhost:4000/api
```

`DB_SYNC=true` auto-creates tables from entities (dev only). After the API is up once:

```bash
node scripts/seed.mjs        # admin → identifier: Admin | password: ycs@2026
node scripts/seed-dummy.mjs  # optional demo data (dev only)
```

## Deploy (Docker / Dokploy)

A multi-stage [`Dockerfile`](Dockerfile) is included.

- Build type: **Dockerfile**, exposed port **4000**.
- Set env vars in the platform (see below); `DB_SYNC=true` once to create the
  schema, then flip to `false`.
- Uploads: use `STORAGE_DRIVER=depot` (or `s3`) so files survive redeploys —
  the local `./uploads` folder is ephemeral on most hosts.

## Scripts

| Command              | Does                          |
|----------------------|-------------------------------|
| `npm run start:dev`  | watch mode                    |
| `npm run start:prod` | run compiled `dist/main.js`   |
| `npm run build`      | `nest build`                  |
| `npm run typecheck`  | `tsc --noEmit`                |
| `npm run lint`       | eslint                        |
| `npm run format`     | prettier --write              |

## Environment

See [`.env.example`](.env.example). Key groups:

- **Server** — `PORT` (4000), `CORS_ORIGIN` (frontend origin, e.g. `https://idola.stekom.ac.id`).
- **Postgres** — `DB_HOST/PORT/USER/PASSWORD/NAME`, `DB_SYNC` (`true` dev only).
- **Auth** — `JWT_SECRET` (must match the frontend), `JWT_EXPIRES_IN`.
- **Google SSO** (voter login) — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`.
- **Storage** — `STORAGE_DRIVER` = `local` | `s3` | `depot`, plus S3/Depot vars.
- **Integrations** — `INTEGRATION_API_KEY` for the companion registration app.

> `.env` is git-ignored. Never commit real secrets — `.env.example` holds placeholders only.

---

## Layout

```
src/
├─ main.ts              bootstrap: /api prefix, CORS+cookies, ValidationPipe, static /uploads
├─ app.module.ts        wires every feature module + ScheduleModule
├─ config/              env → typed config (configuration.ts)
├─ database/
│  ├─ database.module.ts   TypeORM wiring (swap DB = touch this file only)
│  └─ entities/            *.entity.ts + index.ts (single ENTITIES list)
├─ common/
│  ├─ guards/           jwt.guard, roles.guard, api-key.guard
│  ├─ decorators/       @Roles(), @CurrentUser()
│  └─ utils/            password (scrypt), rate-limit, server-hash, normalize
└─ modules/             ONE FOLDER PER FEATURE
   auth · admin (+raffle) · schools · participants · settings · voting
   public · quests · submissions-admin · participant-self · uploads
   rounds (+scheduler) · regions · integrations · health
```

## Adding a feature (convention)

1. Entity → `database/entities/<x>.entity.ts`, register in `entities/index.ts` (`ENTITIES`).
2. `modules/<x>/` → `<x>.module.ts` + `<x>.controller.ts` + `<x>.service.ts` + `dto/`.
3. Protect routes: `@UseGuards(JwtGuard, RolesGuard)` + `@Roles("admin"|"voter")`.
4. Import the module in `app.module.ts`. Done — don't touch other feature files.

Keep controllers thin; logic lives in services. DTOs validate input (class-validator).

---

## API surface

Global prefix `/api` (except `/uploads/*`, served statically).

| Area            | Base path                       | Guard         |
|-----------------|---------------------------------|---------------|
| Health          | `/api/health`                   | —             |
| Auth            | `/api/auth`                     | mixed (login/SSO open, `me` JWT) |
| Admin dashboard | `/api/admin`                    | JWT + admin   |
| Raffle / undian | `/api/admin/raffle`             | JWT + admin   |
| Schools         | `/api/admin/schools`            | JWT + admin   |
| Participants    | `/api/admin/participants`       | JWT + admin   |
| Quests          | `/api/admin/quests`             | JWT + admin   |
| Submissions     | `/api/admin/submissions`        | JWT + admin   |
| Rounds/gelombang| `/api/admin/rounds`             | JWT + admin   |
| Regions         | `/api/admin/regions`, `/api/public/regions` | JWT + admin / public |
| Public data     | `/api/public`                   | —             |
| Voting          | `/api/vote`, `/api/submissions` | **JWT + voter** |
| Media/uploads   | `/api/media`, `/uploads/*`      | mixed         |
| Integrations    | `/api/integrations`             | API key       |

---

## Key domain rules

### Voting (voter-facing)
- **Login required.** `/vote` & `/submissions` need a JWT with role `voter`.
  Voter identity (name / WA / email / status / school / class) is taken from the
  **session profile**, never from the body — can't be spoofed via the API.
- Voters sign in with **Google SSO** and complete a one-time onboarding wizard.
- **Self-vote block** — a voter can't vote a participant whose **email or WA**
  matches their own (they *are* that participant). See `anti-cheat.service.ts`.
- Anti-cheat: device fingerprint, per-user rate-limit, one-WA-one-name, daily
  dedup, first-vote follow gate (+ coupon), IP soft-limit (off by default).
- Two vote kinds: `daily5` (+5, 1×/participant/day) and `fav20` (+20, max 10
  participants/day). Each vote is stamped with the active round.

### Rounds (gelombang)
- One active round at a time. Schools with active participants **auto-join** the
  active round (no manual fill needed).
- `select_mode`: `per_region` (top-N per kabupaten) or `global` (top-N overall,
  e.g. 200 semifinalists).
- Closing a round promotes winners, drops the rest to the **next round** (by
  `sequence`) with **carry_points = 50%** of their final score, and activates it.
- `scheduled_close_at` + hourly cron (`rounds-scheduler.service.ts`) auto-closes
  due rounds.
- Admin can inject synthetic **bot boost** votes (`is_bot`, reversible).

### Integrations (registration app = source of truth)
- Participants are synced **by email** (idempotent key) — see [`INTEGRASI-API.md`](INTEGRASI-API.md).
- Auth via `X-Api-Key` header.

## Notes

- `DB_SYNC=true` is dev-only. Use TypeORM migrations in production.
- Passwords use scrypt (`salt:hash`, no external dep) — swap to argon2/bcrypt for production.
- Uploaded media (local driver) lives in `./uploads` — git-ignored except `.gitkeep`.
- Webhooks (Depot) verify an HMAC over the raw body (`rawBody: true` in `main.ts`).
