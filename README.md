# ycs-voting-api

NestJS backend for **Youth Character Summit (YCS)** — a school voting event.
Own database + auth (rewrite of the earlier Supabase-based FKP voting backend).

Stack: **NestJS 10** · **TypeORM** (Postgres) · **JWT** (httpOnly cookie) ·
Express static uploads · optional S3/MinIO & Depot storage drivers.

Pairs with the admin/public frontend: [`ycs-voting-web`](https://github.com/Revaldoo22/ycs-voting-web).

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
node scripts/seed.mjs        # admin → identifier: Admin | password: admin123
node scripts/seed-dummy.mjs  # optional demo data
node scripts/seed-coupons.mjs
```

## Scripts

| Command              | Does                                  |
|----------------------|---------------------------------------|
| `npm run start:dev`  | watch mode                            |
| `npm run start:prod` | run compiled `dist/main.js`           |
| `npm run build`      | `nest build`                          |
| `npm run typecheck`  | `tsc --noEmit`                        |
| `npm run lint`       | eslint --fix                          |

## Environment

See [`.env.example`](.env.example). Key groups:

- **Server** — `PORT` (4000), `CORS_ORIGIN` (frontend origin).
- **Postgres** — `DB_HOST/PORT/USER/PASSWORD/NAME`, `DB_SYNC` (`true` dev only).
- **Auth** — `JWT_SECRET` (must match the frontend), `JWT_EXPIRES_IN`.
- **Google SSO** (voter login) — `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`.
- **Storage** — `STORAGE_DRIVER` = `local` (default) | `s3` | `depot`, plus the S3/Depot vars.
- **Integrations** — `INTEGRATION_API_KEY` for the companion registration app.

> `.env` is git-ignored. Never commit real secrets — `.env.example` holds placeholders only.

---

## Layout

```
src/
├─ main.ts              bootstrap: /api prefix, CORS+cookies, ValidationPipe, static /uploads
├─ app.module.ts        wires every feature module
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
   rounds · regions · integrations · health
```

## Adding a feature (convention)

1. Entity → `database/entities/<x>.entity.ts`, register in `entities/index.ts` (`ENTITIES`).
2. `modules/<x>/` → `<x>.module.ts` + `<x>.controller.ts` + `<x>.service.ts` + `dto/`.
3. Protect admin routes: `@UseGuards(JwtGuard, RolesGuard)` + `@Roles("admin")`.
4. Import the module in `app.module.ts`. Done — don't touch other feature files.

Keep controllers thin; logic lives in services. DTOs validate input (class-validator).

---

## API surface

Global prefix `/api` (except `/uploads/*`, served statically).

| Area            | Base path             | Guard         |
|-----------------|-----------------------|---------------|
| Health          | `/api/hooks`, `/api/health` | —       |
| Auth            | `/api/auth`           | mixed (login open, `me` JWT) |
| Admin dashboard | `/api/admin`          | JWT + admin   |
| Raffle / undian | `/api/admin/raffle`   | JWT + admin   |
| Schools         | `/api/admin/schools`  | JWT + admin   |
| Participants    | `/api/admin/participants` | JWT + admin |
| Quests          | `/api/admin/quests`   | JWT + admin   |
| Submissions     | `/api/admin/submissions` | JWT + admin |
| Rounds/gelombang| `/api/admin/rounds`   | JWT + admin   |
| Regions         | `/api/admin/regions`, `/api/public/regions` | JWT + admin / public |
| Public data     | `/api/public`         | —             |
| Voting          | `/api/voter`, `/api/participant` | voter/participant session |
| Media/uploads   | `/api/media`, `/uploads/*` | mixed    |
| Integrations    | `/api/integrations`   | API key       |

Anti-cheat (device fingerprint, IP hash, self-vote, rate-limit) lives in
`modules/voting/anti-cheat.service.ts`. Passwords use scrypt (`salt:hash`,
no external dep) — swap to argon2/bcrypt for production.

## Notes

- `DB_SYNC=true` is dev-only. Use TypeORM migrations in production.
- Uploaded media (local driver) lives in `./uploads` — git-ignored except `.gitkeep`.
- Webhooks (Depot) verify an HMAC over the raw body (`rawBody: true` in `main.ts`).
