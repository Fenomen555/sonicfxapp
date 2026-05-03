#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/root/miniapp"
FRONTEND_DIR="$APP_ROOT/frontend"
TARGET_DIR="/var/www/app_sonic_fx_usr/data/www/app.sonic-fx.com"
OWNER="app_sonic_fx_usr:app_sonic_fx_usr"

cd "$FRONTEND_DIR"

if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

npm run build

if [[ ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
  echo "Build failed: dist/index.html not found"
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude=".well-known" "$FRONTEND_DIR/dist/" "$TARGET_DIR/"
chown -R "$OWNER" "$TARGET_DIR"

echo "Deploy success: $TARGET_DIR"
