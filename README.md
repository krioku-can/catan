# Catan Online

Family-friendly Catan for phones and desktop — solo vs AI or multiplayer rooms.

## Play

| Mode | URL |
|------|-----|
| **Game (client)** | https://catan-lac.vercel.app |
| **Server health** | https://catan-4ieq.onrender.com/api/health |

### Local (vs AI)
1. Open the site → enter your name → **Play vs AI**
2. Resume from home if you left mid-game

### Family (online)
1. Host: **Play with Family** → Create room → share code or **Share Room Link**
2. Others: Join with code, or open `?room=CODE`
3. First online open after idle may take **~30s** while the free server wakes

## Features
- Full base Catan rules (setup, production, 7/discard/robber, trade, ports, dev cards)
- Local AI opponents + save/resume
- Online rooms with AI fill
- Seat **rejoin** after refresh (same browser tab session)
- Turn coach banner, dice flash, muteable SFX
- Local stats / history
- Debug board overlay (`🔍` or `?debug=1`)

## Dev

```bash
# Client
cd client && npm install && npm run dev

# Server (separate terminal)
cd server && npm install && npm run dev
# optional: VITE_SERVER_URL=http://localhost:3001 in client
```

### Playthrough harness (rules regression)
```bash
./scripts/playthrough.sh
# or: GAMES=8 PLAYERS="3 4" ./scripts/playthrough.sh
```
Includes a **multi-AI discard-after-7** regression so freezes can’t return silently.

### Deploy
- **Client:** `cd client && vercel deploy --prod` (or push if linked)
- **Server:** push `main` → Render auto-deploy (`server/`)
- Env: client `VITE_SERVER_URL`, server `CORS_ORIGIN` / `PORT`

## Architecture notes
- Canonical rules: `client/src/game/*` → sync copies to `server/src/game` and `shared/game`
- Local AI: `Game.tsx` effect; Online AI: `server/src/index.ts` `runAITurn`
- **Always apply freeze fixes to both paths** (see Hermes skill `catan-game-freeze-debugging`)

## Known limits
- Free Render sleeps when idle (wake UX is built into the lobby)
- Server rooms are in-memory (restart drops active rooms)
- Stats are device-local (`localStorage`), not cloud accounts
