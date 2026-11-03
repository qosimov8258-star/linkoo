#!/bin/sh
# Drops and recreates the LOCAL factory database (linko_factory). Stop the factory dev
# server first (its schema cache would not notice). Never touches the main "linko" DB.
set -e
CONTAINER="${PG_CONTAINER:-linko-business-dashboard-postgres-1}"
docker exec "$CONTAINER" psql -U linko -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS linko_factory WITH (FORCE)" \
  -c "CREATE DATABASE linko_factory OWNER linko"
echo "linko_factory recreated"
