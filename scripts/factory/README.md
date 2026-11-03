# Factory simulation (local only)

A working soft-drink plant, "Zilol Ichimliklar Zavodi" (Tashkent head plant + Samarkand branch), built and run
for one month (October 2026) through the app's own API — the same calls its pages make. It lives in its **own
local database** (`linko_factory`, same Postgres container) and its **own dev server** (port 3001, build folder
`.next-factory`), so the main local database (`linko`, reference parity data) and production are never touched.
Nothing here writes demo rows into `linko`; the scripts refuse any host other than localhost.

## Run

```bash
sh scripts/factory/run-all.sh          # stop :3001, recreate linko_factory, start :3001, run every phase (~12 min)
```

Or step by step:

```bash
sh scripts/factory/reset-db.sh         # drop + create linko_factory (stop the :3001 server first)
sh scripts/factory/dev.sh 3001         # dev server on the factory DB
node scripts/factory/simulate.mjs setup staff catalog production clients month verify closing
FACTORY_DAYS=5 node scripts/factory/simulate.mjs month   # only the first days of the month
```

`next dev` adds `.next-factory/…` to the `include` list of `tsconfig.json` when this server starts; that change is not
needed by the main app: undo it with `git checkout tsconfig.json`.

Sign in at http://localhost:3001 — server field anything, login `admin`, password `Zavod-Admin-2026`
(the one-time initial password `Zavod-2026-admin` is replaced by the script on a fresh database).
Employees with system access sign in with `<first>.<last><n>` / `Zilol-<2026+n>-xodim` and must set a new
password at the first sign-in (admin-set passwords always have to be changed).

## What it builds

| Phase | Content |
| --- | --- |
| `setup` | currencies (SUM base, USD), 2 organizations, 2 branches, 3 price lists, units, product types, brands, shifts, income / expense categories, client types, zones, supplier categories, 18 job positions, capabilities and 9 access rights |
| `staff` | 100 employees (director … guards), 37 with a sign-in account and an access right |
| `catalog` | 5 warehouses (raw, shop floor = manufacturing, finished goods, Samarkand, returns), 4 cash desks (cash, bank, USD, Samarkand), 8 suppliers, 19 raw materials, 17 products with 3 price lists |
| `production` | stage "PET quyish liniyasi": 4 machines, 5 operations, 15 workers, a recipe (raw material norms) per product |
| `clients` | 60 clients (shops, supermarkets, dealers, cafes, wholesale) with agent, deliverer, zone, GPS point |
| `month` | day by day: purchases (on demand) and supplier payments (USD supplier from the USD desk), raw materials to the shop floor, 4 production batches a day (some with brak), finished goods to the warehouse and twice a week to Samarkand (approve → give → accept), 16–24 orders a day through every status, client payments (cash on delivery, dealers by bank a week later), returns, weekly write-offs, expenses, cash collection to the bank, dealer contracts, a supplier return, a supply's transport cost, a wholesale price rise, agents' shop tasks, salary advance on the 15th, attendance of the last week |
| `verify` | compares the app's stock balances with the simulation's own ledger (every warehouse × item) |
| `closing` | payroll for 100 employees («Добавить зарплату» → «Зачислить» → payout of the rest), month-end stock count of the finished goods warehouse |

The run prints every failed API call at the end. `scripts/factory/ui-check.cjs` then opens every page of the
factory instance in headless Chromium and clicks its non-destructive buttons (`SHARD=0/3 … 2/3` for parallel
workers); it reuses `playwright-core` and `routes.txt` from `tools/reference-test`.

The expense categories «Ish haqi» and «Avans» are marked «Не учитывать в P&L»: the P&L takes the salary from the
accruals of «Зарплата и установка планов» (as the reference does), the payouts only settle the employee balances.
