#!/bin/sh
# Second local dev server for the factory simulation: same code, its own database
# (linko_factory on the same local Postgres) and its own build folder, so the main
# local DB (reference parity data) is never touched. Usage: sh scripts/factory/dev.sh [port]
set -e
cd "$(dirname "$0")/../.."
PORT="${1:-3001}"
BASE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
[ -n "$BASE_URL" ] || { echo "DATABASE_URL missing in .env" >&2; exit 1; }
export DATABASE_URL="${BASE_URL%/*}/linko_factory"
export NEXT_DIST_DIR=.next-factory
export ALLOWED_ORIGIN="http://localhost:$PORT"
export ADMIN_INITIAL_PASSWORD="${FACTORY_ADMIN_PASSWORD:-Zavod-2026-admin}"
exec pnpm exec next dev -p "$PORT"
