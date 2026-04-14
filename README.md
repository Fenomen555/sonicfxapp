# SonicFX Mini App (Starter)

Project scaffold:

- `backend/` - FastAPI + aiogram + MySQL bootstrap/migrations
- `frontend/` - React Mini App + Admin route (`/admin/:token`)

## Included from reference approach

- Telegram WebApp `initData` validation (`X-TG-Init-Data`)
- `/start` bot menu with welcome + WebApp button + language switch
- Auto create/update DB schema on startup
- Admin token protection via `X-Admin-Token`
- Mobile fullscreen/safe-area handling in frontend
- Theme tokens: `:root[data-theme="dark"]` and `:root[data-theme="light"]`

## Backend setup

1. Copy env:
   - `backend/.env.example` -> `backend/.env`
2. Fill required values:
   - `BOT_TOKEN`, `WEB_APP_URL`, `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`
   - `DEVSBITE_TOKEN` (for market pairs)
3. Optional market settings:
   - `DEVSBITE_MIN_PAYOUT=60`
   - `MARKET_SYNC_INTERVAL_SEC=300`
   - `EXPIRATION_OPTIONS=5s,15s,1m,5m,15m,1h`
   - `DEVSBITE_EXPIRATIONS_URL=` (if your provider has dedicated expirations endpoint)
4. Install deps and run:
   - `pip install -r backend/requirements.txt`
   - `cd backend`
   - `python main.py`

## Frontend setup

1. Install deps:
   - `cd frontend`
   - `npm install`
2. Run dev:
   - `npm run dev`
3. Build:
   - `npm run build`

Build output:

- `frontend/dist`

Production target path:

- `/var/www/apps_devsbit_usr/data/www/apps.devsbite.com`

## Current API highlights

- User:
  - `POST /api/user/sync`
  - `POST /api/user/profile`
  - `POST /api/user/settings`
- News:
  - `GET /api/news`
  - `GET /api/stats/daily`
- Market:
  - `GET /api/market/options?kind=forex|otc`
  - `GET /api/pairs/forex`
  - `GET /api/pairs/otc`
  - `GET /api/expirations`
- Admin:
  - `GET /api/admin/me`
  - `GET /api/admin/stats`
  - `GET /api/admin/users`
  - `GET/POST /api/admin/feature-flags`
  - `POST /api/admin/users/set-activation`
