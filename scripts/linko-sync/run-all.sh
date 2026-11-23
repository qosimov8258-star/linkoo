#!/bin/sh
# Imports a downloaded Linko account (backups/linko-raw/<date>, see fetch.mjs) into the local database, in the order
# the importers depend on each other. Back the database up first (pg_dump -Fc). The last step compares the stock with
# Linko through the running app: start it on the same database and pass its address and a session cookie.
#
#   sh scripts/linko-sync/run-all.sh
#   LOCAL_URL=http://localhost:3002 LOCAL_COOKIE='linko_session=…' sh scripts/linko-sync/run-all.sh
#
# Another Linko account: RAW=<its download folder> TARGET_DB=<its database> sh scripts/linko-sync/run-all.sh. With RAW
# set every step reads only inside RAW (a capture the folder lacks skips that step); without RAW the steps read the
# first account's backups/linko-raw/<date> folders. Both are passed to every step. A database holds one Linko account
# (lib.mjs connect(): marked on its first import; the first account's files go only into DATABASE_URL's database, any
# other account's only into its own TARGET_DB). The base steps (import-base-*.mjs, right after prepare-target.ts) create
# the account's base rows a new copy starts without (currencies, organizations, branches, warehouses, staff, cashboxes,
# suppliers, the catalog, the clients) and update them on a copy that has them; every later step attaches its rows to
# them. prepare-target.ts stops a run into a database without clients, products and employees whose download lacks the
# lists they are made from (ALLOW_EMPTY_BASE=1 runs it anyway).
set -e
# A RAW or TARGET_DB that is set but empty (RAW=$UNSET) is a mistake, never "the first account".
if [ -n "${RAW+set}" ]; then
  # Absolute before the cd below, so a RAW relative to the caller's directory still names the same folder.
  { [ -n "$RAW" ] && [ -d "$RAW" ]; } || { echo "RAW is not a folder: '$RAW'" >&2; exit 1; }
  RAW=$(cd "$RAW" && pwd)
  export RAW
fi
if [ -n "${TARGET_DB+set}" ]; then
  [ -n "$TARGET_DB" ] || { echo "TARGET_DB is set but empty" >&2; exit 1; }
  export TARGET_DB
fi
echo "raw: ${RAW:-newest backups/linko-raw/<date>}  database: ${TARGET_DB:-the one of DATABASE_URL / .env}"
cd "$(dirname "$0")"
run() { echo "== $1"; node "$1"; }
# TypeScript steps that use the app's own engine (lib/…): run with tsx, server-only modules allowed.
run_ts() { echo "== $1"; node ../../node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig ../../tsconfig.json "$1"; }

# The account and database belong together, the copy has its base rows or the lists they are made from, the app's
# lazily created tables exist
run_ts prepare-target.ts
# Base rows, under Linko's ids. Each step creates the app's tables it writes into (with the app's own code, tsx).
# Org and people first: currencies, organizations, branches, warehouses, positions, access rights and their
# capabilities, start locations, employees, subscriptions (everything below names them).
run import-base-org-people.mjs
# Cashboxes (their cashier, branch, currency), supplier categories and suppliers, document and notification templates,
# refusal types
run import-base-finance-suppliers.mjs
# Units, product types, brands, price list headers, products (+ raw materials, net cost cache), order Excel layouts,
# product attributes, rival products
run import-base-catalog.mjs
# Client types, categories, attributes, classification, the shops (clients), the financial accounts and their links,
# restrictions
run import-base-clients.mjs
# Order headers (the shop, account, agent, delivery man, totals, payment terms); import-orders.mjs adds the lines and
# the history and keeps the status, warehouse and client in line
run import-base-orders.mjs
# Catalog and sales documents
run import-deleted-products.mjs
run import-product-boxes.mjs
run import-product-capacity.mjs
run import-product-cards.mjs
run import-price-list-items.mjs
run import-price-bounds.mjs
run import-raw-cards.mjs
run import-promotions.mjs
run import-system-pages.mjs
run import-draft-orders.mjs
run import-orders.mjs
run import-order-divisions.mjs
run import-order-promotions.mjs
run import-order-filter-facts.mjs
run import-order-deliverers.mjs
run import-order-payment-lines.mjs
run import-returns.mjs
run import-return-logs.mjs
run import-return-price-lists.mjs
run import-return-order-lines.mjs
run import-order-line-returns.mjs
run import-order-line-promotions.mjs
run import-return-marks.mjs
# Report builder data (saved reports, templates, static widgets) and what its reports read: each order line's
# price-list price, the return reasons, the orders' creation moment in UTC
run import-report-details.mjs
run import-series.mjs
run import-balance-flags.mjs
# Warehouse documents (supplies, returns to suppliers, write-offs, transfers, inventories) and production
run import-supplies.mjs
run import-supplier-details.mjs
run import-supply-refs.mjs
run import-stock-docs.mjs
run import-inventory-series.mjs
run import-inventory-weights.mjs
run import-transfer-series.mjs
run import-transfer-prices.mjs
run import-transfer-logs.mjs
run import-cancelled-transfers.mjs
run import-gears.mjs
run import-reprice-items.mjs
run import-production.mjs
run import-party-costs.mjs
run import-net-cost-history.mjs
# Finance
run import-finance-categories.mjs
run import-account-links.mjs
run import-finance-cash.mjs
run import-payment-moments.mjs
run import-finance-corrections.mjs
run import-finance-suppliers.mjs
run import-finance-ledgers.mjs
run import-branch-docs.mjs
run import-vansell-docs.mjs
run import-finance-contracts.mjs
run import-document-accounts.mjs
run import-document-rates.mjs
run import-document-internals.mjs
run import-cash-list-facts.mjs
run remove-demo-salary-plans.mjs
# Clients and settings lists
run import-client-options.mjs
run import-client-bonuses.mjs
run import-market-activity.mjs
run import-settings-lists.mjs
run import-amount-precision.mjs
run import-branch-flags.mjs
run import-permission-tags.mjs
run import-knowledge-base.mjs
run import-surveys.mjs
# Field work and staff
run import-zones.mjs
run import-zone-agents.mjs
run import-market-users.mjs
run import-shop-drawer.mjs
run import-shop-closed.mjs
run import-shop-state.mjs
run import-field-records.mjs
run import-route-plans.mjs
run import-monthly-plans.mjs
run import-visits.mjs
run import-gps.mjs
run import-employee-tracking.mjs
run import-employee-cards.mjs
run import-attendance.mjs
run import-tasks.mjs
run import-task-photos.mjs
run import-salary-cards.mjs
run import-notifications.mjs
run import-auth-logs.mjs
run fix-auth-log-collisions.mjs
# «Выполнения KPI»: Linko's monthly snapshots recomputed here as of Linko's recalculation moments (needs the orders with
# their logs, returns, payments, visits and holidays above, and the KPIs and employees already in the database; raw
# month files from the same download as the other steps)
run_ts import-kpi-balances.ts
# Stock movements Linko keeps without a document (needs the app running on this database). The default LOCAL_URL
# (:3002) serves the first account's database, so with TARGET_DB the app's address must be given.
if [ -n "${LOCAL_COOKIE:-}" ] && [ -n "${TARGET_DB:-}" ] && [ -z "${LOCAL_URL:-}" ]; then
  echo "== import-stock-residuals.mjs skipped: TARGET_DB is set, so set LOCAL_URL to the app running on $TARGET_DB"
elif [ -n "${LOCAL_COOKIE:-}" ]; then
  run import-stock-residuals.mjs
else
  echo "== import-stock-residuals.mjs skipped: set LOCAL_URL and LOCAL_COOKIE (see its header)"
fi
echo "Done."
