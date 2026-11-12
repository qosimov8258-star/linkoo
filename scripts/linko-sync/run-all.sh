#!/bin/sh
# Imports a downloaded Linko account (backups/linko-raw/<date>, see fetch.mjs) into the local database, in the order
# the importers depend on each other. Back the database up first (pg_dump -Fc). The last step compares the stock with
# Linko through the running app: start it on the same database and pass its address and a session cookie.
#
#   sh scripts/linko-sync/run-all.sh
#   LOCAL_URL=http://localhost:3002 LOCAL_COOKIE='linko_session=…' sh scripts/linko-sync/run-all.sh
set -e
cd "$(dirname "$0")"
run() { echo "== $1"; node "$1"; }

# Catalog and sales documents
run import-deleted-products.mjs
run import-product-boxes.mjs
run import-price-list-items.mjs
run import-promotions.mjs
run import-orders.mjs
run import-order-deliverers.mjs
run import-returns.mjs
# Warehouse documents (supplies, returns to suppliers, write-offs, transfers, inventories) and production
run import-supplies.mjs
run import-stock-docs.mjs
run import-production.mjs
run import-net-cost-history.mjs
# Finance
run import-account-links.mjs
run import-finance-cash.mjs
run import-finance-corrections.mjs
run import-finance-suppliers.mjs
run import-finance-ledgers.mjs
run import-finance-contracts.mjs
run import-document-accounts.mjs
run import-document-rates.mjs
run remove-demo-salary-plans.mjs
# Clients and settings lists
run import-client-options.mjs
run import-settings-lists.mjs
run import-branch-flags.mjs
run import-surveys.mjs
# Field work and staff
run import-zones.mjs
run import-field-records.mjs
run import-route-plans.mjs
run import-visits.mjs
run import-gps.mjs
run import-employee-tracking.mjs
run import-attendance.mjs
run import-tasks.mjs
run import-notifications.mjs
run import-auth-logs.mjs
run fix-auth-log-collisions.mjs
# Stock movements Linko keeps without a document (needs the app running on this database)
if [ -n "${LOCAL_COOKIE:-}" ]; then
  run import-stock-residuals.mjs
else
  echo "== import-stock-residuals.mjs skipped: set LOCAL_URL and LOCAL_COOKIE (see its header)"
fi
echo "Done."
