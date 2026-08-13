# Linko Dashboard — Backend Wiring Plan

Goal: connect every remaining `components/**/*-view.tsx` that currently owns its
own mock/in-memory rows to the real SQLite backend (`lib/db.ts` +
`better-sqlite3`), following the established pattern:

1. Add a `CREATE TABLE IF NOT EXISTS` block to `lib/db.ts` (+ seed-if-empty using
   the component's current mock array, same as `seedClients`/`seedOrders`).
2. Add `lib/<entity>-repo.ts` with `list/create/update/remove` (see
   `lib/clients-repo.ts`, `lib/orders-repo.ts` for the shape).
3. Add `app/api/<entity>/route.ts` (GET list, POST create) and
   `app/api/<entity>/[id]/route.ts` (PATCH, DELETE) — copy
   `app/api/clients/route.ts` + `app/api/clients/[id]/route.ts`.
4. Switch the view component from local `useState(mockArray)` to
   `fetch("/api/<entity>")` with loading/error state, and point
   add/edit/delete handlers at the API instead of local array mutation.

Already done (reference implementations, do not touch): `clients`, `orders`,
`currencies`, `cashboxes`, `income_categories`, `expense_categories`,
`customer_payments`, `supplier_payments`.

**Note on `*-balance-view` / `*-debts-view` files** (client-balance,
branch-balance, employee-balance, supplier-balance, cash-balance, vansell-balance,
account-debts, client-debts, supplier-debts, balance-tab, branch-tab): these
render a running balance = `opening` (a manually entered starting number) +
movements computed from real transactions (orders/payments/cashbox ledger).
They do **not** need their own row-per-entity table. Instead: add an
`opening_balance_sum/usd/eur` column to the *owning* entity's table (clients,
branches, employees, suppliers, cashboxes) and compute the rest from the
already-wired transaction tables. Treat these as SKIP for new tables, but they
DO need their fetch-from-API wiring once the owning entity + its opening
balance field exist (batch 9).

---

## Batch 1 — Product/Catalog reference data
- `organizations` — `organization-view.tsx`: `{ id, name, limitByDebt }`
- `units_of_measure` — `units-of-measure-view.tsx`: `{ id, name, createdDate, parentId }` (self-FK)
- `product_types` — `product-types-view.tsx`: `{ id, name, organization, createdDate, showInBot, parentId }` (self-FK)
- `brands` — `brands-view.tsx`: `{ id, name, organization, createdDate, photoUrl }`
- `price_lists` — `price-lists-view.tsx`: `{ id, name, currency, createdDate, linkedList, calcMethod }`

## Batch 2 — Products & raw materials
- `products` — `products-view.tsx`: `{ id, name, fullName, barcode, article, type, organization, unit, subUnit, createdDate, orderNumber, hasPhoto, ... }` (FK: type→product_types, unit→units_of_measure, organization→organizations); read full file for the tail of the interface before implementing.
- `raw_materials` — `raw-materials-view.tsx`: `{ id, name, fullName, barcode, article, type, organization, unit, subUnit, createdDate, orderNumber, supplier, ... }` (FK: supplier→suppliers, so implement after batch 4, or nullable FK)
- `price-formation-view.tsx` — SKIP new table: reads/prices `products` (cost, priceMin, priceMax, canSell) — add those columns to `products` table directly instead of a separate entity.
- `repricing-view.tsx` (revaluation runs) — `{ id, createdBy, createdAt, priceList, amount, currency, status, user, product }` → table `repricings`, FK product→products, priceList→price_lists.

## Batch 3 — Warehouses & stock movement
- `warehouses` — `warehouses-view.tsx`: `{ id, name, address, branch, manager, createdDate, online, active }`
- `write_offs` (+ `write_off_items`) — `write-offs-view.tsx`: header `{ id, creator, warehouse, date, status, comment, reason }`, items `{ id, product, code, series, block, qty, cost, sum }`
- `internal_transfers` (+ items) — `internal-transfers-view.tsx`: `{ id, fromWarehouse, toWarehouse, createdBy, createdAt, deliveredAt, amount, weight, status, priceList, organization, invoiceNumber }`, items `{ id, product, quantity, weight, price }`
- `goods-movement-dashboard.tsx` / `stock-movement-page.tsx` — these are tab-shells over receipts/transfers/movements; SKIP dedicated tables, they should read from `write_offs`/`internal_transfers`/supplier incomings once those exist. Verify by reading the two files fully before wiring — they may need a `stock_movements` ledger table if receipts aren't otherwise modeled.
- `stock-level-view.tsx`, `reorder-level-view.tsx` — SKIP, derived report over `products` + movement tables.

## Batch 4 — Suppliers & supplier transactions
- `supplier_categories` — `supplier-categories-view.tsx`: `{ id, name }`
- `suppliers` — `suppliers-view.tsx`: `{ id, name, category, createdDate, address, branch, organization, contacts: Contact[], products: Product[] }` (contacts/products as JSON columns or child tables; FK category→supplier_categories)
- `supplier_incomings` (+ items) — `supplier-incomings-view.tsx`: header `{ id, supplier, warehouse, date, paymentType, contractNumber, amount, status, invoiceNumber, organization, branch, phone, ... }`, items `{ id, product, expiry, qty, block, kg, netWeight, cost, total }`
- `supplier_returns` (+ items) — `supplier-returns-view.tsx`: header `{ id, fromWhom, warehouse, addedBy, date, time, amount, status, organization, currency, paymentType, priceList, ... }`, items `{ id, product, qty, series, price, total }`

## Batch 5 — Cash management & finance extras
- `cash_ledger` — `cashboxes-view.tsx` `LedgerEntry`/`PendingRequest` types + `cash-management-view.tsx` (same shape, likely the same feature reused) — `{ id, cashboxId/cashboxName, description, category, clientName, branch, organization, comment, date, amount }`; pending requests `{ id, createdBy, cashboxName, branch, organization, amount, date }`. Reconcile the two components — they look like duplicates of the same cash-ledger feature; wire both to one `cash_ledger` + `cash_pending_requests` table pair.
- `cashback_withdrawal_requests` — `cashback-withdrawal-requests-view.tsx`: `{ id, client, amount, currency, status }` (FK client→clients)
- `loyalty_cards` (+ transactions) — `loyalty-card-view.tsx`: `{ id, client, balance: Money, transactions: Transaction[] }` (FK client→clients)
- `contracts` — `contracts-view.tsx`: `{ id, createdAt, client, hasInfo, zone, agent, inn, status, officialName, year, organization, comment }` (FK client→clients)

## Batch 6 — Personnel
- `branches` — `branches-view.tsx`: `{ id, name, date, debtTracking, isMain, priceList, currency }` (add `opening_balance_sum/usd` here per the balance-view note above)
- `positions` — `positions-view.tsx`: `{ id, name, date }`
- `employees` — `employees-view.tsx`: `{ id, name, login, role, extraPermission, phone, position, active }` + `Draft` fields (`firstName, lastName, phone, integrationCode, position, branch, systemAccess, showInTracking, twoStepCheck, sessionLimit, gpsCheck, startPoint`). FK position→positions, branch→branches. Read full file — Draft has more boolean flags beyond what's captured; capture them all before building the table.
- `access_rights` (roles) — `access-rights-view.tsx`: `Role { id, name, capabilities: string[] }` (capabilities as JSON column or child table)
- `shifts` — `shifts-view.tsx`: `{ id, name, user, createdAt, opening, income, expense, expected, actual, difference, closedAt }`
- `time_restrictions` — `time-restrictions-view.tsx`: `{ id, name, from, to, fullDay }`
- `knowledge_base` (articles) — `knowledge-base-view.tsx`: `{ id, name, text, active, roles: string[], fileName }`

## Batch 7 — Personnel KPI/planning
- `salary_planning` — `salary-planning-view.tsx`: `{ id, employee, salary, bonus, kpi, credited }` (FK employee→employees)
- `branch_kpi_plans` — `branch-kpi-plans-view.tsx`: `{ id (branch), name, bonus, kpi }` per month/year — needs a `(branch_id, month, year)` composite key table, not just branch id.
- `kpi-views.tsx` (`kpi_tasks`) — `{ id, name, planType, clientType, comment, active, system }`
- `tasks` — `tasks-view.tsx`: `{ id, responsible, date, store, description, status }` (FK responsible→employees, store→clients)
- `activity-view.tsx` — read file fully (no interface captured); likely an activity/audit log — probably SKIP (derived from other tables) unless it has its own add form.
- `attendance-view.tsx` — read file fully; likely `{ employee, date, checkIn, checkOut, ... }` — real CRUD table `attendance`.
- `agent-working-time-view.tsx` — read file fully; likely derived report over attendance/tracking — probably SKIP.
- `equipment-efficiency-view.tsx` — `{ client, equipment, branch, inventoryType }` rows look derived/reporting off `inventory_management`; confirm during implementation, likely SKIP.

## Batch 8 — Client-side settings & CRM extras
- `client_types` — `components/clients/client-types-view.tsx`: `{ id, name, supplier, date }`
- `client_attributes` — `components/clients/attributes-view.tsx`: `{ id, name, fieldType, required }`
- `client_attribute_values` — `components/clients/attribute-values-view.tsx`: `{ id, attribute, values: string[], textOnly }` (FK attribute→client_attributes)
- `client_module` rows — `components/clients/client-module-view.tsx`: `{ id, name, category, detail, value, status, statusLabel, updatedAt }`
- `duplicate_analysis` groups — `duplicate-analysis-view.tsx`: `{ id, inn, phone, clients: string[] }` — likely SKIP/derived (computed by scanning `clients` for matching inn/phone) rather than its own table; confirm no "ignore/merge" persisted action exists before deciding.
- `financial-accounts-view.tsx`, `client-restrictions-view.tsx`, `restrictions...`, `routes-analysis-view.tsx`, `territory...`, `telegram-users-view.tsx` (all under `components/clients/`) — none had a captured interface; read each fully during this batch to classify CRUD vs derived before building tables.

## Batch 9 — Balance/debt views (opening-balance columns + wiring)
Add `opening_balance_sum/usd/eur` (as applicable) to: `clients` (already has
`balance` — reuse it), `branches`, `employees`, `suppliers`, `cashboxes`
(vansell-type ones). Then wire these views to read the owning entity + compute
running totals from real transaction tables:
- `client-balance-view.tsx`, `client-debts-view.tsx`, `account-debts-view.tsx`
- `branch-balance-view.tsx`, `branch-tab-view.tsx`, `balance-tab-view.tsx`
- `employee-balance-view.tsx`
- `supplier-balance-view.tsx`, `supplier-debts-view.tsx`
- `cash-balance-view.tsx`, `vansell-balance-view.tsx`
- `store-reconciliation-bot-view.tsx` — `ClientRow { id, client, connected, debtTerm, daysAfterPayment, daysAfterOrder, amount, sumCash, sumTransfer, ... }` — the `connected`/`debtTerm`/day thresholds are real per-client settings (add columns to `clients` or a `client_reconciliation_settings` table); the amounts are derived.
- `expected-payments-view.tsx`, `expected-expenses-view.tsx`, `debt-limits-view.tsx` — mostly derived from `orders`/`customer_payments`/`supplier_payments`; `debt-limits-view.tsx`'s per-client limit value may need a `debt_limit` column on `clients`.

## Batch 10 — Sales-adjacent CRUD (components/orders/*)
- `client_bonuses` (+ history) — `client-bonuses-view.tsx`: `BonusClient { id, name, points, lastScore, history: BonusEntry[] }`, `BonusEntry { product, quantity, order, type, promotion, date, points }` (FK client id → clients)
- `marketing_campaigns` — `marketing-campaigns-view.tsx`: `{ id, name, start, end, type, active }`
- `perfect_store_configs` — `perfect-store-config-view.tsx`: `{ id, name, active }`
- `refusal_types` — `analytics/refusal-types-view.tsx`: `{ id, name, resolution }`
- `refusals` — `orders/refusals-view.tsx`: `{ id, date, agent, client, reason }` (FK client→clients, reason could FK refusal_types by name)
- `returns` — `orders/returns-view.tsx`: `{ id, client, zone, warehouse, product, supplier, date, accepted, amount, agent }`
- `mailing` — `orders/mailing-view.tsx`: `{ id, message, createdAt, createdAtDetail, status, sent, blocked, debt, photo }`
- `questionnaire-view.tsx` (surveys) — `{ id, name, createdAt, active, organization, storeType, comment }`
- `survey-plan-view.tsx` — `PlanEntry { employee, survey }` per month/year — composite-key table like branch_kpi_plans.
- `perfect-store-view.tsx`, `photo-reports-view.tsx`/`photo-report-review-view.tsx` — read fully; likely real submission logs (`perfect_store_submissions`, `photo_reports`) tied to clients/employees — build tables once fields are confirmed.

## Batch 11 — Production
- `production_stages` — `production-stages-view.tsx`: `Stage { id, name }`, plus per-stage `Product/Operation/SimpleRow` children — read full file for exact child shapes before building.
- `production_batches` — `production-batches-view.tsx`: `{ id, startedAt, completedAt, batchDate, stage, user, status }` (FK stage→production_stages)
- `material-report-view.tsx` / `material-report-view-v2.tsx` — SKIP, derived aggregate over production + stock tables.

## Batch 12 — Inventory (client-placed equipment, not warehouse stock)
- `inventory_management` items — `inventory-management-view.tsx`: `InventoryItem { id, serialNumber, client, inventoryType, inventoryCode, warehouse, condition, responsible, attachDate, createdDate, checkDate, approved }`, plus `MovementLog` and `CheckLog`/`RequestRow` children (movement/approval history tables, FK to the item)
- `product_restrictions` — `product-restrictions-view.tsx`: `Restriction { id, employee, items: string[] }` for both "products" and "types" tabs — two tables or one with a `kind` column.

## Batch 13 — Telegram / knowledge / misc singletons
- `telegram_bot_pages` — `telegram-bot-pages-view.tsx`: `{ key, title, description, createdAt, updatedAt, content: Record<lang,string> }` (key is the primary key, not autoincrement id)
- `telegram-users-view.tsx` (components/clients) — read fully; likely read-only list synced from Telegram — confirm if it has any editable/persisted fields before deciding SKIP vs table.
- `dashboard-settings-view.tsx` (`Dashboard { id, name }`) and `flexible-dashboard-view.tsx` (`Dashboard { id, name, widgets }`) — user-defined dashboard layouts; currently `flexible-dashboard-view.tsx` persists to `localStorage` (`storageKey`) — could stay client-local, or move to a `dashboards` table keyed by user if cross-device persistence matters. Low priority.
- `notifications-menu.tsx` (dashboard bell) — `NotificationItem`/`TaskItem` — currently pure mock; likely should become real notifications generated by the backend (e.g. from order status changes) rather than a manually CRUD'd table — treat as SKIP for now, revisit once real events exist to generate them from.

## SKIP — derived/reporting only, no new table needed
These read and aggregate data from tables that already exist or will exist
after the batches above; they just need their `fetch()` wired once the
underlying entities are real (no schema work of their own):
`pnl-view`, `management-balance-view`, `analytics-report-view`,
`analytics-section-view`, `abc-analysis-view`, `agent-profit-view`,
`product-profit-view` (page, not in components/analytics list above but same
family), `coverage-analysis-view`, `client-dynamics-view` (both copies),
`sales-by-agents-view`, `sales-by-products-view`, `sales-tab-view`,
`category-expenses-view`, `payroll-expenses-view`, `report-builder-view`,
`old-report-builder-view`, `new-report-builder-view`, `report-list-view`,
`trend-builder-view`, `visit-builder-view`, `visits-by-day-view`,
`goods-movement-view`, `system-distribution-view`, `store-time-view`,
`client-sales-payments-view`.

## Files needing a full read before classifying (no interface found by grep)
`abc-analysis-view.tsx`, `activity-view.tsx`, `agent-profit-view.tsx`,
`agent-working-time-view.tsx`, `attendance-view.tsx`,
`client-sales-payments-view.tsx`, `goods-movement-view.tsx`,
`new-report-builder-view.tsx`, `old-report-builder-view.tsx`,
`photo-report-review-view.tsx`, `sales-by-products-view.tsx`,
`sales-tab-view.tsx`, `store-time-view.tsx`, `system-distribution-view.tsx`,
`telegram-users-view.tsx`, `territory-view.tsx` (clients), `routes-analysis-view.tsx`,
`client-restrictions-view.tsx`, `restrictions...`, `financial-accounts-view.tsx`,
`trend-builder-view.tsx`, `visits-by-day-view.tsx`, `report-list-view.tsx`,
`equipment-efficiency-view.tsx`, `duplicate-analysis-view.tsx`.

---

## Suggested execution order
Batches 1 → 4 (catalog/warehouse/supplier chain, since products/suppliers are
FK'd by almost everything downstream), then 6 (personnel, needed for
`employee`/`branch` FKs used everywhere), then 10 (sales/orders extras), then
2's price-formation, 5 (cash), 7, 8, 9, 11, 12, 13 — 9 last since it depends on
columns added to entities from every earlier batch.
