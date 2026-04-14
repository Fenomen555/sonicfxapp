#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/root/miniapp"
FRONTEND_DIR="$APP_ROOT/frontend"
TARGET_DIR="/var/www/apps_devsbit_usr/data/www/apps.devsbite.com"
OWNER="apps_devsbit_usr:apps_devsbit_usr"

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
