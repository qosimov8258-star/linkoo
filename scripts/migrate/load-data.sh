#!/bin/sh
# Loads a data package (a `pg_dump -Fc` file of a Mezon database, e.g. the Linko data) into the database of this
# Docker Compose deployment, in place of its current data. Run it on the server, from the project folder (the one
# with docker-compose.yml and .env):
#
#   sh scripts/migrate/load-data.sh /path/to/linko-data.dump
#
# (TARGET_DB=<name> sh scripts/migrate/load-data.sh … loads into another database instead, for a trial run.)
#
# What it does:
#   1. backs up the current database to backups/backup-<time>.dump (restore it with the same script);
#   2. keeps this server's sign-in accounts (users) and settings (app_settings: the app currency …);
#   3. stops the app, recreates the database from the package and puts the kept accounts back;
#   4. starts the app again (it brings the tables up to date by itself on start).
# Kept accounts lose their link to an employee and their access right (the package has its own employees and roles):
# the administrator signs in as before and sets them again in Права доступа → Пользователи.
set -eu

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: sh scripts/migrate/load-data.sh <package.dump>" >&2
  exit 1
fi

# The compose settings: .env first, then the environment, then the defaults of docker-compose.yml.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
DB_USER="${POSTGRES_USER:-linko}"
# TARGET_DB=<name> loads into another database of the same server (a trial run) instead of the app's own.
DB_NAME="${TARGET_DB:-${POSTGRES_DB:-linko}}"
COMPOSE="${COMPOSE:-docker compose}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

pg() { $COMPOSE exec -T postgres "$@"; }

echo "1/4 backup of $DB_NAME -> backups/backup-$STAMP.dump"
pg pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "backups/backup-$STAMP.dump"

echo "2/4 keeping the sign-in accounts and settings"
KEEP_TABLES=$(pg psql -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT string_agg('-t ' || quote_ident(tablename), ' ') FROM pg_tables WHERE schemaname = current_schema() AND tablename IN ('users', 'app_settings')")
if [ -n "$KEEP_TABLES" ]; then
  # Their structure too: a package may come without these tables (it carries no accounts).
  # shellcheck disable=SC2086
  pg pg_dump -U "$DB_USER" --schema-only $KEEP_TABLES "$DB_NAME" > "backups/keep-schema-$STAMP.sql"
  # shellcheck disable=SC2086
  pg pg_dump -U "$DB_USER" --data-only --column-inserts $KEEP_TABLES "$DB_NAME" > "backups/keep-$STAMP.sql"
else
  : > "backups/keep-schema-$STAMP.sql"
  : > "backups/keep-$STAMP.sql"
fi

echo "3/4 replacing the data (the app is stopped meanwhile)"
$COMPOSE stop app
pg dropdb -U "$DB_USER" --if-exists "$DB_NAME"
pg createdb -U "$DB_USER" "$DB_NAME"
pg pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl < "$DUMP"
# The package's own accounts and settings make way for this server's. A package without these tables gets this
# server's structure for them first (no constraint of it may fail: the accounts' links are cleared below).
for TABLE in users app_settings; do
  EXISTS=$(pg psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT to_regclass('$TABLE') IS NOT NULL")
  if [ "$EXISTS" = "t" ]; then
    pg psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -c "TRUNCATE $TABLE CASCADE"
  fi
done
MISSING=$(pg psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT count(*) FROM (VALUES ('users'), ('app_settings')) t(n) WHERE to_regclass(n) IS NULL")
if [ "$MISSING" != "0" ] && [ -s "backups/keep-schema-$STAMP.sql" ]; then
  # Only the missing tables' statements matter; the others fail harmlessly (already there).
  pg psql -U "$DB_USER" -d "$DB_NAME" -q < "backups/keep-schema-$STAMP.sql" || true
fi
# The kept rows go in without the foreign-key checks (their employee / access right ids are cleared next).
{ echo "SET session_replication_role = replica;"; cat "backups/keep-$STAMP.sql"; echo "SET session_replication_role = DEFAULT;"; } |
  pg psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q
pg psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -c "
  UPDATE users SET employee_id = NULL, access_right_id = NULL;
  SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM users), 0), 1));"

echo "4/4 starting the app"
$COMPOSE start app
echo "Done. The previous data is in backups/backup-$STAMP.dump (load it the same way to go back)."
