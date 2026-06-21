# 🌋 Volcano Cats — Backend (v2)

Game server untuk Volcano Cats. Setup di-refactor mengikuti pola modern: ESM + `tsx` (no build step) + Zod validation + pino logging.

## Tech Stack
- **Runtime**: Node.js 20+ (ESM native, `"type": "module"`)
- **Game Server**: Colyseus `^0.16`
- **Dev/Run**: `tsx` — jalankan TypeScript langsung, tanpa compile step terpisah
- **Validation**: Zod — validasi runtime semua pesan dari client
- **Logging**: pino (+ pino-pretty untuk dev)
- **Deploy**: Railway

## Kenapa Beda dari Versi Sebelumnya?

Versi sebelumnya (CommonJS + `tsc` build step) gagal deploy di Railway. Penyebab paling mungkin:

1. **Tidak bind ke `0.0.0.0`** — `gameServer.listen(PORT)` tanpa host eksplisit. Banyak platform container butuh bind ke semua interface.
2. **`@colyseus/monitor` + chained `.filterBy()/.sortBy()/.enableRealtimeListing()`** — API yang sensitif terhadap versi exact Colyseus, berisiko throw saat boot kalau versi tidak match persis.
3. **Build command ganda** (`npm run build && npm start` sebagai satu start command, padahal Nixpacks juga auto-detect `build` script) — berpotensi race/double-build yang membingungkan.
4. **`require()` dinamis** di tengah kode TypeScript — anti-pattern yang rawan gagal di environment compiled/bundled.

Perbaikan di v2:
- ✅ `httpServer.listen(PORT, "0.0.0.0", ...)` — eksplisit
- ✅ Hapus monitor & realtime listing API yang tidak esensial
- ✅ `tsx` menjalankan source langsung — **tidak ada build step sama sekali**, jadi tidak ada kemungkinan mismatch antara build output dan start command
- ✅ Semua import jadi ES modules murni
- ✅ Graceful shutdown untuk `SIGTERM` (penting karena Railway redeploy kirim sinyal ini)

## Setup Local

```bash
npm install
cp .env.example .env

npm run dev      # tsx watch — hot reload otomatis
```

Server jalan di `http://localhost:3001`. Cek `http://localhost:3001/health` untuk healthcheck.

## Deploy ke Railway

1. Push repo ke GitHub
2. Buat project baru di [Railway](https://railway.app), connect repo
3. Set environment variables di Railway dashboard:
   - `CLIENT_URL` = URL Vercel frontend kamu (untuk CORS)
   - `NODE_ENV` = `production`
   - `LOG_LEVEL` = `info` (opsional, default `info` di production)
4. Railway otomatis baca `railway.json` + `nixpacks.toml`, set `PORT` sendiri, lalu jalankan `npm start`
5. Setelah deploy, cek `https://<your-app>.up.railway.app/health` — harus return `{"status":"ok",...}`

> Kalau masih gagal deploy: cek **Deploy Logs** di Railway dashboard dulu — pesan error di sana jauh lebih spesifik daripada menebak dari sini. Hal pertama yang perlu dicek: apakah `npm install` sukses, dan apakah proses langsung crash saat start (lihat stack trace).

## Struktur Project

```
src/
├── index.ts                  # Entry point — Express + Colyseus + graceful shutdown
├── rooms/
│   └── VolcanoCatsRoom.ts    # Room handler, validasi Zod per pesan masuk
├── game/
│   └── engine.ts             # Pure game logic (tidak berubah dari versi sebelumnya)
├── schemas/
│   └── messages.ts           # Zod schema untuk setiap tipe pesan client→server
├── types/
│   ├── cards.ts               # Definisi kartu
│   └── game.ts                 # GameState, Player, dll
└── lib/
    └── logger.ts              # Setup pino logger
```

## Validasi Pesan (Zod)

Setiap pesan dari client divalidasi sebelum diproses. Kalau payload tidak sesuai schema (field hilang, tipe salah, dll), server kirim balik `ERROR` tanpa pernah menyentuh game state:

```ts
// schemas/messages.ts
export const playCardSchema = z.object({
  cardId: z.string().min(1).max(128),
  targetId: z.string().min(1).max(64).optional(),
});
```

Ini lapisan keamanan tambahan di luar validasi logic game (`validatePlayCard` dkk di `engine.ts`) — TypeScript types hilang saat runtime, jadi client yang di-modify (lewat devtools, atau client custom) tidak bisa kirim payload sembarangan.

## WebSocket Messages

Sama seperti sebelumnya — lihat tabel di README frontend untuk daftar lengkap message types.

## Catatan Versi Colyseus

Saya pakai `@colyseus/core@^0.16` + `@colyseus/ws-transport@^0.16` (bukan `^0.17` seperti referensi awal) karena saya tidak punya akses untuk verifikasi breaking changes API 0.17 secara langsung saat menulis ini, dan tidak mau menebak. Kalau kamu mau pindah ke 0.17:

1. Cek [Colyseus changelog](https://docs.colyseus.io/changelog) untuk breaking changes
2. Bump versi di `package.json`
3. `npm install` lalu `npm run typecheck` — kalau ada API yang berubah, TypeScript akan langsung kasih tahu di mana
