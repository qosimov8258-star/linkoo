# Linko → Mezon data sync

Copies a Linko account (app.linko.uz, server `time3`, …) into the **local** database of this app, into the real tables
the pages read — orders with their lines and history, returns, promotions with their full setup, supplies with lines,
expenses and history, returns to suppliers, write-offs, transfers, inventories, production, every money movement,
contracts, rates, visits, photo reports, refusals, GPS tracks, attendance, tasks, notifications, sign-in journal — so
every page shows what Linko shows.

Linko is only **read** (GET requests). The downloaded files hold business data: they live in
`backups/linko-raw/<date>/` (git-ignored) and must never be committed — this repository is public.

## Run

```sh
# 1. back the local database up
docker exec linko-business-dashboard-postgres-1 pg_dump -U linko -Fc linko > backups/linko-before-sync.dump

# 2. download (read-only) — a few minutes; GPS tracks take the longest
LINKO_SERVER=time3 LINKO_USER=admin LINKO_PASS=… node scripts/linko-sync/fetch.mjs

# 3. import, in dependency order (the last step needs the app running on the same database)
LOCAL_URL=http://localhost:3002 LOCAL_COOKIE='linko_session=…' sh scripts/linko-sync/run-all.sh
```

Every importer is idempotent (run it again after a new download and it updates what changed) and writes what it did
into `linko_sync_rows` (table, row id, action and the previous row of an update or delete). `TARGET_DB=<name>` points
the importers at another database of the same server; a remote host is refused unless `ALLOW_REMOTE=1`.

## What Linko does differently, and how it is kept

- **Inventories**: Linko books an inventory's differences as separate documents (a supply from "Инвенторизация" for a
  surplus, a write-off for a shortage). Imported inventories are `booked_by_documents = 1`, so the stock ledger does not
  count their differences twice; those supplies are `is_inventory = 1` and charge no supplier.
- **Production**: what reached the stock follows Linko's stock history (`stock/barcode_history`): a batch line Linko never
  booked keeps `in_stock = 0`; booked movements a batch no longer lists become batch-less movements of its stage.
- **Stock without a document** (balances loaded by Linko's 1C integration into the "Ожидается синхронизация: …"
  warehouses, equipment issued from a warehouse, a few corrections): production movements of direction `adjust`
  marked "Linko: …" (the ledger's "Прочие" column), so every product's balance in every warehouse equals Linko's.
- **Client ledger**: an order Linko booked no debt for is `orders.no_debt = 1`; a return carries what Linko credited
  (`client_returns.client_credit`, also for returns still pending there; a credit in another currency than the
  return's in `client_credit_other`).
- **Prices**: every product's price per price list (`price_list_items`, read product by product: Linko's paged list
  answers 500 for some pages) goes to `products.price_lists` with the derived `price_min` / `price_max` (the app's rule:
  positive prices in the base currency) and Linko's last price change day in `price_updated_date`
  (`import-price-list-items.mjs`). Linko's own Цена(мин) / Цена(макс) are snapshots taken when a price was last saved
  (old currency rates, prices changed since), so about 100 of 805 differ from the app's live values.
- **Долги доставщиков**: Linko books every client transaction with its own delivery man and counts it for him once
  accepted (an order once В пути / Доставлено, on its accepted day; an accepted payment or return; a correction). An
  order whose delivery man was changed after it was booked keeps the one Linko booked in `orders.debt_delivery_man_id`
  (`import-order-deliverers.mjs`). The list is whoever's access right carries the «Доставщик» capability.
- **Financial accounts**: Linko keeps a client's debt per financial account. A document booked on another account than
  its shop's current one (the shop moved later), or a payment booked on an account without any shop, carries that
  account (`financial_account_id` on orders, returns, payments, corrections, withdrawals — `import-document-accounts.mjs`),
  so «Долги по счетам» and the client list's balance (the shop's account, as Linko shows it) equal Linko's; the shop's
  own balance (Баланс клиентов, its card) is unchanged. A deleted account is not listed but still holds its shops' money.
- **Reservations** follow Linko: unconfirmed orders ("Не подтвержден") and confirmed transfers reserve stock.
- **Same names**: document lines carry the catalog key (`"key": "product:<id>"`), supplies and supplier returns the
  supplier id, shops their financial account — so Linko products, suppliers and accounts that share a name stay apart.
- Products Linko deleted but its documents still name are kept as deleted products (left out of Остаток, as in Linko).
- Small lists an older build seeded and its "legacy seed" cleanups would delete when they look seeded (Telegram bot
  users, Транспорт, Смены, notification subscribers) are written so the cleanups leave them alone
  (`import-settings-lists.mjs`); the example surveys and survey plans of that seed are replaced by Linko's
  (`import-surveys.mjs`).

Linko itself answers 500 for a few documents (some returns, inventory 125, some repricings, production records); their
lines come from other lists where Linko has them (see `fetch.mjs` steps `returns-patch`, `manufacture-returns`).
