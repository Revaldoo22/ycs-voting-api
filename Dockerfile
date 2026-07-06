# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install semua deps (termasuk dev) untuk build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Buang dev deps → node_modules siap produksi.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Hanya artefak yang perlu untuk jalan.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Seed scripts — dijalankan manual sekali via `node scripts/seed.mjs`
# (exec ke container di Dokploy). Tidak jalan otomatis saat start.
COPY --from=build /app/scripts ./scripts

# Folder uploads (dipakai static serve lokal; kalau STORAGE_DRIVER=depot,
# file disimpan remote tapi folder tetap ada agar bootstrap tidak error).
RUN mkdir -p uploads

EXPOSE 4000
CMD ["node", "dist/main.js"]
