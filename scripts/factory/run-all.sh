#!/bin/sh
# Full factory simulation from an empty database: stops the factory dev server, recreates
# linko_factory, starts the server again (port 3001) and runs every phase.
set -e
cd "$(dirname "$0")/../.."
LOG="${FACTORY_LOG:-/tmp/linko-factory-dev.log}"
pkill -f "next dev -p 3001" 2>/dev/null || true
sleep 2
sh scripts/factory/reset-db.sh
nohup sh scripts/factory/dev.sh 3001 > "$LOG" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null -m 5 http://localhost:3001/login && break; sleep 1; done
node scripts/factory/simulate.mjs "$@"
