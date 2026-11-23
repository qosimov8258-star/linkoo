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
  count their differences twice; those supplies are `is_inventory = 1` and charge no supplier. A line's series is kept
  by its id (`stock_inventory_items.series_id` → `stock_series`, its name in `series`): `import-stock-docs.mjs` writes
  it with the lines, `import-inventory-series.mjs` (after `import-series.mjs` and `import-stock-docs.mjs`) adds it to
  lines imported before, only where the document's lines are still Linko's (product and amount in the same place).
  Each line's weights (Linko's `total_weight` / `total_weight_netto`: the difference × one unit's weight, the edit form's
  «Вес» / «Вес нетто») go to `stock_inventory_items.total_weight` / `total_weight_netto` the same way:
  `import-stock-docs.mjs` with the lines, `import-inventory-weights.mjs` for lines imported before.
- **Products' series flags**: `import-series.mjs` reads «Учитывать срок годности» (`use_expiration`) from the products
  nested in documents; `import-balance-flags.mjs` (after it) takes the flags of every product from `all_balances.json`
  (`stock/all_balances/`, rows with `title`), so a product that appears in no document gets its flag too.
- **Поставки** (`import-supplies.mjs`): besides the header and lines, the invoice comment of «Изменить детали счет
  фактуры», the expected dates (`will_be_sent_out_date` / `will_come_to_post_date`), per line the marking flag and
  counts (`useMark`, `markStat` from `use_mark` / `mark_stat`), and the history with Linko's action codes
  (`change_invoice`, `sent_out`, `come_to_post` as they are; `arrived` → `accepted`, `cancel_arrived` → `unaccepted`,
  `canceled` → `cancelled`), the status code of each entry and the event day of «Добавить лог». The contract number
  (Linko's `contract` is a plain string), Linko's line id per line (`linkoId`, the «№» of «Скачать» → «Продукты
  поставки») and Linko's «Оплачено» (`total_paid` → `linko_paid`: Linko allocates payments over a supplier's debts, so
  the card starts from that figure and adds only the payments entered in the app afterwards). Additional costs keep
  Linko's ids (cash entries point at them through `supply_expense_id`; a re-run updates them in place), their
  distribution type (`distribute_type`) and `bind_to_provider`. `DRY=1` lists the supplies and columns a run would
  change and rolls back.
- **Поставки → «Поиск» и «Фильтр»** (`import-supply-refs.mjs`, after `import-supplies.mjs`): Linko's list search
  matches the id, the supplier, the supplier's contact person on the supply, the comment and the warehouse id, and its
  filter picks warehouses, branches and organizations by id (several share a name). Per supply the contact's name
  (`contact.name` of `stock/supply/{id}/`) and the ids of `stock`, `branch` and `division` go to
  `supplier_incomings.contact_name`, `warehouse_id`, `branch_id` and `organization_id` (an id the local table does not
  know stays empty). Only these columns are written, each change registered with the previous values; `DRY=1` lists the
  changes and rolls back.
- **Переоценка**: Linko's list has no products; `import-reprice-items.mjs` puts each document's products (from
  `main/reprice/{id}/`) into `repricings.items`, with the factor Linko used for the old price, so lines and totals equal
  Linko's. Linko answers 500 for a few documents: they stay without lines.
- **Передачи между складами → Серия**: a transfer line holds one series, as in Linko: `import-stock-docs.mjs` stores
  its id in `stock_series` (`seriesId`, its name in `series`); `import-transfer-series.mjs` (after `import-series.mjs`
  and `import-stock-docs.mjs`) adds the id to lines imported before, only where the local line is the same line (place,
  product, quantity) without a series id. Series chosen or distributed in the app («Авто распределение по сериям»,
  marked `seriesAuto`) are left alone.
- **Передачи между складами → Цены**: a transfer without a price list keeps the prices typed on its lines in Linko
  (often 0) and no currency; the app values at the cost of goods only the transfers it gives itself.
  `import-transfer-prices.mjs` (after `import-stock-docs.mjs`) puts Linko's line prices back on copied transfers an
  earlier app version had valued at cost (lines marked `priced: "cost"`, only where the transfer and its lines are still
  as imported) and clears the import's fallback currency SUM where Linko has none. `DRY=1` lists the changes and rolls
  back.
- **Передачи между складами → Логи**: fetch step `transfer-logs` reads `stock/stock_transfer/{id}/logs/`;
  `import-transfer-logs.mjs` writes them to `internal_transfer_logs` (a transfer with the app's own log is left alone).
- **Передачи между складами → отмененные**: Linko lists a cancelled transfer only with «Показать отмененные передачи»
  (`with_cancelled=true`, in the manifest since 2026-11-20); the 2026-11-06 download missed the 13 cancelled ones.
  `import-cancelled-transfers.mjs` adds them (status «отменен», no stock or money effect) with their «Логи» from a
  read-only capture of the screens (`backups/linko-raw/2026-11-20/stock-transfers-cancelled`, `CANCELLED_DIR=` picks
  another; Linko cannot open the cards of 4, 5, 10, 15 and 17, so those come without log rows). A transfer live here is
  never touched. `DRY=1` lists the changes and rolls back.
- **Заказы → карточка → «Список оплат по заказу»**: Linko lists an order's debt transactions
  (`sales/debt_transactions/?order={id}`: each payment, client return or other credit that paid a part of the order and
  the share it paid). Fetch step `order-debt-transactions`, or a read-only capture of the cards' payment lists, saves
  `order_debt_transactions.json` (`{ tpl, data: { orderId: [rows] } }`); `import-order-payment-lines.mjs` stores each
  order's list as Linko shows it in `orders.linko_payment_lines` (JSON; `[]` = Linko has none, NULL = not copied: the
  app lists its own payments). Payments made in the app after the copy are added to the list by the app.
- **Возвраты → Логи**: fetch step `return-logs` reads `sales/order_return_logs/?order_return={id}` (or a capture of the
  cards' «Логи» tabs saved as `order_return_logs.json`); `import-return-logs.mjs` writes them to `client_return_logs`
  in Linko's order (by Linko id, so a re-run updates them). The app appends its own entries to the same table.
- **Возвраты → коды маркировки**: fetch step `return-marks` reads `sales/order_return_product/{id}/get_marks/` for
  every returned line of `order_returns_detail.json` (run it after `details` and `returns-patch`; a capture of the
  cards' green «+» in a read-only browser gives the same `order_return_marks.json`); `import-return-marks.mjs` writes
  the codes to `client_return_item_marks` (by Linko mark id), tied to the local line at the same place of the return.
- **Возвраты → Серии**: `import-series.mjs` copies Linko's series catalog (`stock/series/` → `stock_series`, by Linko
  id), the series of order lines (`sales/order_product_exp/` → `order_item_series`; an order whose series were set in
  the app — «Изменит серии» or «Авто распределение по сериям» of the order card / list — is left alone) and of return lines
  (`sales/order_return_product_exp/`, the full list from fetch.mjs or a capture of the cards' «Серии» tabs saved as
  `{<return id>: rows}` → `client_return_item_series`, tied to the local line at the same place of the return; a return
  whose series were set in the app is left alone), and sets `products.track_expiry` / `track_series` from the
  `use_expiration` / `use_series` of the product objects nested in documents (Linko's product list has neither). The
  stock ledger keeps no balances per series (Linko's `stock/series_balance/` is not copied: the app estimates each
  series' balance per warehouse from the series its documents name, `lib/order-series-balance.ts`). A series row whose line `import-returns.mjs` replaced (new line ids, the
  old lines kept in `linko_sync_rows` as "replace") moves to the new line with the same product / order line /
  occurrence; a row whose line was deleted in the app stays hidden. It also sets `clients.realization_by` («Реализация
  по», read by «По типу указанному у клиента») from `market.use_stock_lifo` in `shop_drawer.json`: LIFO when true, FIFO
  only over a LIFO (empty already reads as FIFO).
- **Возврат поставщиков**: `import-stock-docs.mjs` keeps a line's series by its id in `stock_series` (`seriesId`, its
  name in `series`; run `import-series.mjs` first), Linko's `return_from_old_base` in `from_old_base` (such a return is
  never edited), and the hand-over («Время передачи» / «Передал») of a return Linko cancelled later, as its card shows
  it. `ONLY=supplier_returns` (or `write_offs`, `internal_transfers`, `stock_inventories`, comma-separated) runs only
  those sections.
- **Поставщики**: Linko's list (`stock/provider/`) has no contacts or reserve, only each supplier's card has them
  (`stock/provider/{id}/`, the `providers` entry of the manifest's details → `providers_detail.json`).
  `import-supplier-details.mjs` writes its «Контакты» (`suppliers.contacts`, Linko's order), «Добавить запас»
  (`reserve_products` → `suppliers.products`: product id and name, unit, amount, cost, currency, `manual_cost` as
  `manual`) and its modified_date (the card's «Дата добавления») into `suppliers.updated_at`. Without a full download it
  reads the read-only capture `backups/linko-raw/2026-11-20/providers_detail.json` (`PROVIDERS_DETAIL=<file>` picks
  another); `DRY=1` lists the changes.
- **Склад → Работа с инвентарем**: `import-gears.mjs` copies Linko's equipment (`main/gear/` → `inventory_items`, same
  ids; the card `main/gear/{id}/` for each item's own date, empty when Linko has none, and its photo file address and
  file id, `photo_id`, which the card's photo viewer puts in `openImageDialog=<id>`),
  `main/gear_log/` (История движений) and `main/gear_check/?with_image=true` (История проверки, with each review's photo list → `inventory_item_checks.images`) into `inventory_item_logs` /
  `inventory_item_checks` by Linko id (`linko_id`, new rows in Linko's id order), `main/gear_condition/` (Состояние)
  into `inventory_conditions`, and flags the products Linko keeps as inventory (`stock/all_balances/?is_gear=true` →
  `products.is_inventory`, their server order → `inventory_product_positions`, the order of the form's Продукт select). A photo uploaded in the app is kept, and so are movements and reviews made in the app.
- **Территория → агенты зон**: fetch step `border-agents` reads each territory's `market/border/{id}/` (its agents
  are only there); `import-zone-agents.mjs` writes them to `client_zone_agents` («Привязать / Отвязать агента»).
- **Карточка клиента → «Агенты магазина»**: fetch step `market-users` reads each shop's `market/market/{id}/?with_extra_message=1`
  (its market users are only there: agent, comment, price lists; ~1 request per shop); `import-market-users.mjs` writes
  them to `client_market_users` («Изменение агентов»). Rows set in the app (no Linko id) are kept on a re-run.
- **Карточка клиента → ЗАДАЧИ, КЛИЕНТ → ДЕТАЛИ / ЛОГИ**: `fetch-shop-drawer.mjs` reads each shop's
  `market/market/{id}/` detail (price list, «Статус ИНН», «Создал», last payment day), its `detail_plans` (the ЗАДАЧИ
  timeline) and its `market_logs` (ЛОГИ), all pages, plus `market_logs?type=` of each type it has twice or more (the
  filter pills: Linko returns one type in an order of its own, kept as `type_position`), into `shop_drawer.json`;
  `import-shop-drawer.mjs` writes them to `linko_market_cards` (also ФИНАНСОВЫЕ НАСТРОЙКИ, the market options' order and
  «Комментарий отказа»), `linko_market_plans` and `linko_market_logs` in Linko's order. A copied shop's card shows
  Linko's rows and, before them, what the app recorded after the copy (tasks, orders, returns, visits, payments).
  The same step also saves every shop's `last_order_date` / `last_visit_date` (`market_activity`); `import-market-activity.mjs`
  writes them to `clients` («Охват территорий» «Перестали покупать» / «Нет заказа», the card's «Прошло дней …»).
- **Карточка клиента → «Закрыто»**: `import-shop-closed.mjs` reads each shop's `is_closed` from the same `shop_drawer.json`
  (else `markets.json` of the full download) into `linko_shop_closed`; the drawer's header shows Linko's red «Закрыто»
  chip for those shops on every page. The app has no closing of its own, so a shop made here is never marked.
- **Карточка клиента → «Статус объекта», «Локация»**: `import-shop-state.mjs` reads each shop's `is_active` and `location`
  from the same `shop_drawer.json` (else `markets.json`). `is_active` goes to `client_object_status` (the drawer header's
  green / red dot, the Клиенты row border and «Статус объекта»; the rows there before were a demo seed). The first copy
  stored the points through float4 columns (41.322964 for 41.322962): a point only that rounding away from Linko's gets
  Linko's full value, a point moved in the app is kept and reported. The edit form's «Реализация по» (`use_stock_lifo`:
  LIFO, else FIFO) is filled where the copy has none.
- **Анализ маршрутов → агент → «план продаж»**: Linko's `sales/monthly_plan/` (list `monthly_plans`) goes to
  `monthly_sales_plans` via `import-monthly-plans.mjs` (a sales sum and АКБ per organization, a quantity per product;
  rows of zeros and product-type rows are skipped). Plans set in the app (no Linko id) are kept on a re-run.
- **Production**: what reached the stock follows Linko's stock history (`stock/barcode_history`): a batch line Linko never
  booked keeps `in_stock = 0`; booked movements a batch no longer lists become batch-less movements of its stage.
- **Партии, the figures inside a batch**: Linko shows each made line at the cost it stored (a finished batch's raw cost
  over its good units, null while pending) and its own `total_raw_cost` (which also counts raw material it no longer
  lists). `import-party-costs.mjs` keeps them in `linko_party_costs`; the batch detail of a copied batch shows them and
  its lines as booked, while the app's own batches follow the cost ledger. The ledgers are not touched.
- **Конструктор отчетов → Отчеты / Виджеты**: the saved reports (`report_configs` + its detail list: who sees each one),
  Linko's templates (`report_patterns`) and static widgets (`static_widgets` + detail); `import-report-details.mjs`
  writes them to `old_saved_reports` (with `users` / `positions` / `view_type`), `old_report_patterns` and
  `old_static_widgets`. Linko's position ids are the access rights' ids.
- **Stock without a document** (balances loaded by Linko's 1C integration into the "Ожидается синхронизация: …"
  warehouses, equipment issued from a warehouse, a few corrections): production movements of direction `adjust`
  marked "Linko: …" (the ledger's "Прочие" column), so every product's balance in every warehouse equals Linko's.
- **Client ledger**: an order Linko booked no debt for is `orders.no_debt = 1`; a return carries what Linko credited
  (`client_returns.client_credit`, also for returns still pending there; a credit in another currency than the
  return's in `client_credit_other`). Editing a copied return moves that credit with its new amount.
- **Return price lists**: a return's «Прайс лист» (Linko's `price_list`, by name) goes to `client_returns.price_list`
  (`import-return-price-lists.mjs`, after `import-returns.mjs`).
- **Страницы телеграм бота**: `import-system-pages.mjs` writes Linko's system pages (`system_pages` + their detail) to
  `ref_records` kind `tg-page` (by key), with Linko's id as `linkoId`: the page's link is /analytics/telegram-pages/<id>,
  as Linko's #/system-pages/<id> (a key works too).
- **Order organization ids**: `import-order-divisions.mjs` (after `import-orders.mjs`) sets `orders.organization_id` to
  Linko's division id of each copied order (raw `orders`). Several divisions share a name («Pampers» ×3), and the
  Заказы «Организация» filter, like Linko's, filters by id; an order of the app (no id) is matched by its name.
- **Order promotions and bonus lines**: `import-order-promotions.mjs` (after `import-orders.mjs`) copies the promotions
  Linko applied to each order (`orders.promotions`, the card's «Задействованные акции») and Linko's bonus flag of each
  order line (`order_items.is_bonus`: the card's green «(бонус)», 0 in «Скидка», a read-only line in «Быстрая правка»).
- **Order filter facts**: `import-order-filter-facts.mjs` (after `import-order-promotions.mjs` and
  `import-deleted-products.mjs`) copies what Заказы «Показать фильтр» reads besides the order rows: `orders.with_discount`
  (a manual discount; «Тип акции» = «Скидочная» lists it when no promotion applies), `orders.is_new` («Только новые»),
  `orders.collector_id` («Сборщик»), `orders.service_shipment_status` (the list's EDO icon), Linko's `use_mark` as `products.marked_product` («Есть маркированный товар») and the
  type / brand of deleted products («Тип товара» / «Бренд»). It also reads the newer read-only captures of
  `backups/linko-raw/2026-11-20/sales-orders-list` when present (`LIVE_DIR` to point elsewhere).
- **Return form order lines**: `import-return-order-lines.mjs` (after `import-returns.mjs`) keeps Linko's order line id on
  each copied order line (`order_items.linko_order_product_id`, the «(N)» of the return form's picker and of the lines
  an order brings) and points every copied return line at the local copy of its own Linko order line. With
  `CARDS=<folder>` it also takes the line facts of return cards captured later with the read-only harness.
- **Бонусы клиентов**: `import-client-bonuses.mjs` writes the history of every client's points (Linko's
  `sales/client_promotion/<client>/detail/`: hand scores `custom_ball`, prize orders `order_prize`, delivered orders,
  accepted returns) to `client_bonus_entries` by Linko's entry id. The page sums them per client (Linko's ball and
  «Дата последнего бала»), so the run checks the sums against Linko's list (`client_promotions.json`) and reports every
  client that differs. Linko has no list of all entries: `client_promotion_details.json` is a read-only capture of each
  client's dialog (`{data: {<client id>: [entries]}}`). Entries added in the app (no Linko id) are left alone.
- **Promotion of an order line**: `import-order-line-promotions.mjs` (after `import-return-order-lines.mjs`) sets
  `order_items.promotion` to the name of the promotion Linko gives each copied line (`order_product.promotion`, set on
  bonus lines; matched by `linko_order_product_id`): the «Акция: <name>» under a line in the «Наименование» picker of
  the order's «Изменит серии».
- **Returned quantity of an order line**: `import-order-line-returns.mjs` (after `import-return-order-lines.mjs`) sets
  `order_items.return_quantity` (the order card's and the order dialog's «10 [-5] Dona») to Linko's `return_amount` from
  the order cards captured later with the read-only harness (`sales_order_<id>_.json` under `backups/linko-raw/<date>/…`,
  the newest one per order): a return Linko cancelled after the full download no longer counts.
- **Отказы of deleted shops**: `import-field-records.mjs` also keeps the shop's name of every refusal in
  `field_refusals.client_name` (Linko's `market.name`): a shop deleted in Linko has no `clients` row here, and Linko's
  refusal list and card still name it (9 of the 141 refusals). The list shows the shop's own name when it exists.
- **Интеграция (черновики заказов)**: `import-draft-orders.mjs` writes Linko's `sales/draft_order/` to `ref_records`
  (2026-11-20: also the raw `createdDate`, `dateDelivery` and `totalPrice` the list's header sort orders by)
  kind `draft-order` (by Linko id). Besides the names and ids the integration sent (`s_market_*`, `s_user_*`,
  `s_delivery_man_*`), a draft keeps the records Linko linked it to (`market` as {id, name}, `deliveryMan`, `user`;
  null while none is): the list prints them in bold («Не указано» while null), a linked client links to the Клиенты
  page, and the «… не указан» filters test them. Every printed field is refreshed from the newest raw file (the total
  with Linko's 5 decimals, «4,14221 SUM»), and the draft's card lines (`products`: product, quantity, sum) come from
  `draft_order_details.json` (the cards `sales/draft_order/<id>/` captured with the read-only harness). A draft deleted
  in the app stays deleted.
- **Cost of goods (Себестоимость)**: Linko's cost history becomes the history of the app's cost ledger
  (`import-net-cost-history.mjs`): each product's initial cost (Linko's 2010-01-01 record) goes to
  `products.initial_cost`, every other record (the cost after a supply, a cost set by hand, a revaluation; per
  warehouse for Бухоро склад / 11111) becomes a `net_cost_entries` row of source `linko`, and `linko_history`
  'net_cost' marks the copy moment: before it production output and inventory-surplus supplies come in at the average,
  as Linko books them. Формирование цен shows the cost of the scope booked last, like Linko. Result: every product's
  cost equals Linko's (805 of 805, «Не установлена» for the 52 it never valued); the Себестоимость total
  324,52 mlrd (Linko 324,51). Linko's БАЛАНС tab values the stock differently again (stats/stock/balances_sum,
  342,0 mlrd: running values per warehouse that disagree with its own costs), so the app's Склад card shows the
  Себестоимость value.
- **Prices**: every product's price per price list (`price_list_items`, read product by product: Linko's paged list
  answers 500 for some pages) goes to `products.price_lists` with the derived `price_min` / `price_max` (the app's rule:
  positive prices in the base currency) and Linko's last price change day in `price_updated_date`
  (`import-price-list-items.mjs`). Linko's own Цена(мин) / Цена(макс) (`products_net_costs` `min_price` /
  `max_price`) are not derived from the current prices: every price Linko writes moves them (the lowest and the highest
  price the product was ever given, cash and transfer, a zero included, at the rate of that day), so a price changed
  later never narrows them. `import-price-bounds.mjs` (after `import-price-list-items.mjs`) copies them into
  `products.price_min` / `price_max` (null → 0, which Linko prints as «0»); from then on the app moves them the same way
  on every price write (`lib/item-prices.ts` `setItemPrices`).
- **Долги доставщиков**: Linko books every client transaction with its own delivery man and counts it for him once
  accepted (an order once В пути / Доставлено, on its accepted day; an accepted payment or return; a correction). An
  order whose delivery man was changed after it was booked keeps the one Linko booked in `orders.debt_delivery_man_id`
  (`import-order-deliverers.mjs`). The list is whoever's access right carries the «Доставщик» capability.
- **Financial accounts**: Linko keeps a client's debt per financial account. A document booked on another account than
  its shop's current one (the shop moved later), or a payment booked on an account without any shop, carries that
  account (`financial_account_id` on orders, returns, payments, corrections, withdrawals — `import-document-accounts.mjs`),
  so «Долги по счетам» and the client list's balance (the shop's account, as Linko shows it) equal Linko's; the shop's
  own balance (Баланс клиентов, its card) is unchanged. A deleted account is not listed but still holds its shops' money.
  An order Linko booked no debt for (cancelled, «без долга») carries the account written on the order.
- **Заказы «Баланс»** (Linko's market_internal_balance): the order's financial account, its accepted documents only,
  each at the rate Linko booked it at (`linko_document_rates`, `import-document-rates.mjs`; the app's own documents at
  their debt rate or the rate history) — 928 of 928 orders equal Linko's. To the fifth decimal a foreign-currency
  document counts what Linko booked it at (`linko_document_internals`, `import-document-internals.mjs`: Linko's
  client_transactions amount and internal per document) while its amount is still Linko's, summed as exact decimals —
  604 of the 605 listed orders print Linko's digits (2026-11-20; the other one is a return accepted in the app).
- **Управления кассой / Баланс кассы → the list** (`import-cash-list-facts.mjs`, after the finance steps; raw: the
  read-only harness captures `backups/linko-raw/2026-11-20/finance-cash/cash_transactions_live.json` and
  `unverified_transactions.json`): a client payment's cash transaction can name another type, order or client than its
  client transaction («<client> Заказ № <order>»), an acceptance kept as a cash entry names its agent only in Linko's
  `user`, an order payment kept as a cash entry has no order column: those facts go to `linko_cash_list_facts`, which
  only the cash list reads (a payment shows them while it still has the client / type / order it had at import time).
  Linko's unverified transactions (the clock badge; `finance/transaction/unverified_transactions/`, missing from the
  `own=True` list) become cash entries with `is_verified = 0`, so no balance counts them until they are verified. Run it
  after `import-finance-cash.mjs`, which removes cash entries it does not know.
- **Категории приходов / расходов** (`import-finance-categories.mjs`, before the cash steps; raw: `income_categories`,
  `expense_categories`, or `RAW=backups/linko-raw/2026-11-20/finance-lists` for the read-only captures of 2026-11-20):
  Linko's rows by id — name, option («Параметры», stored as the app's dialog saves it: the app's title of the option in
  `parameter`, so the app's own option names such as «Карта клиента» stay), «Прочий приход», «Род. категория»,
  «Внутренний расход», «Не учитывать в отчёте P&L», creation time. Only differing columns are written (registered with
  the previous values), a missing Linko row is added under its id, the app's own rows («Приход от сотрудников») stay;
  `DRY=1` lists the changes and rolls back. The first copy had kept one expense category with an older option and parent.
- **By realization date** (Баланс клиентов, Сверка счетов / магазина «По дате реализации»): a return Linko still holds
  as pending counts only once accepted (by creation date from the day it was made), and an order counts on the day
  Linko accepted it (`orders.accepted_date`, its delivery day — 372 of 574 imported orders left the warehouse on
  another day).
- **Tracking, catalog, branches**: «Показывать в отслеживании» and the live locations (`import-employee-tracking.mjs`,
  needs `fetch.mjs` step `employee-details`; the live locations also come from a read-only capture of Отслеживание's
  `market/way` saved as `market_way.json`: `RAW=backups/linko-raw/<day> node scripts/linko-sync/import-employee-tracking.mjs`), the rest of each employee's card the list leaves out
  (`import-employee-cards.mjs`, same raw file): «Права доступа», which Linko keeps on a blocked user too, «Заблокирован»
  (`is_blocked`, set by «Ограничить доступ сотрудника») → `employees.system_access`, and «Указать исходную точку» with
  its «Точки локации» (the form's «Доступ к системе» is `is_active` = `employees.active`), Linko's raw materials and product boxes (`import-product-boxes.mjs`),
  every «Основной филиал» flag and map point (`import-branch-flags.mjs`: Linko's "0 0" of a branch saved without a point
  stays "0 0", a branch that never had one stays empty, as its form prints them).
- **Объем продуктов** (`import-product-capacity.mjs`): Linko's product `capacity` («Объем») into `products.volume` as a
  plain number (the first copy kept «Не указано м³.»); Остаток «Показать: Объем» multiplies the quantity by it.
- **Карточка продукта** (`import-product-cards.mjs`): what only Linko's product card (`main/product/{id}/`) carries —
  «Минимальный остаток», «Поставщик», «Описание», «Продать только в группе», «Балл», «Показывать в боте»
  (`show_in_market`), ММЛ, the min / max sale price, shelf-life days, «Дополнительные параметры» (`box_sizes`, Linko's
  all-zero row included) and the real «Код для интеграции» (the list answers the first barcode as `code`) — into
  `products`; the products of Linko's «Удалённые» tab missing here are added as deleted products, and the attribute
  values («Характеристика», `product_options`) go to `product_attribute_assignments` ({attribute id: value}). Source:
  read-only captures of the cards (the SPA's own GETs while `#/product/{id}` opens) in
  `backups/linko-raw/<day>/product-detail/products_detail.json` and the «Удалённые» list `products_show_deleted.json`
  (`RAW=<folder>` for another; `DRY=1` only reports).
- **Карточка сырья** (`import-raw-cards.mjs`): the same captured cards for Linko's raw materials (`is_raw`) into the
  `raw_materials` rows the Сырье page lists (matched by name, then unit: they have ids of their own) — «Поставщик»,
  «Описание», «Минимальный остаток», «Вес», «Вес нетто», «Балл», ММЛ, «Показывать в боте», «Продать только в группе»,
  shelf life / series / marking flags — and the prices (`price_lists`, `price_min` / `price_max`,
  `price_updated_date`) of the products row with the card's Linko id. Runs after `import-price-list-items.mjs`
  (`DRY=1` only reports).
- **Права доступа** (`import-permission-tags.mjs`): Linko's permission tags (Мобильный, Десктоп, Общее, CONFIGURATION —
  the «Тип» filter of «Создать возможности») into `permission_tags` and `permissions.tags`, from read-only captures of
  its billing `permission/?tag=general` and `permission_tag/` in `backups/linko-raw/2026-11-20/permission-tags`
  (`TAGS_DIR=<folder>` for others).
- **База знания** (`import-knowledge-base.mjs`): Linko's articles (`main/knowledge/`: name, text, «Активный») and their
  «Права доступа» — Linko links an article to ACCESS RIGHTS (`main/position/`, the local `access_rights` ids), so the
  links go to `knowledge_base_article_access_rights`, exactly Linko's set. Source: the capture
  `backups/linko-raw/2026-11-20/knowledge-base/knowledge.json` (`KB_FILE=<file>` for another), else the full download's
  `knowledge`. Linko's attached files are not copied (they live on its media server).
- **Округление сумм** (`import-amount-precision.mjs`): Linko's settings `ROUND_AMOUNT_FOR_CURRENCY` and
  `SUPPLY_ROUND_AMOUNT` (from its `config` response, manifest list `config`; `RAW=<folder>` or the newest
  `backups/linko-raw/<date>/config.json`) go to `app_settings` (`round_amount_for_currency`, `supply_round_amount`):
  the decimals every screen prints, rounds and types amounts with (Настройки → Округление сумм, `lib/amount-precision.ts`).
  A setting Linko does not have stays unset (three decimals).
- **Задачи → plan photos** (`import-task-photos.mjs`, after `import-tasks.mjs`): the picture link Linko keeps on a plan
  the agent closed with a photo (`today_plans[].image_url` of `main/task/<id>/`) goes to `task_plans.photo` of the same
  plan (task, day, comment), so the task drawer shows «Просмотреть» as Linko's; a photo stored by the app is kept.
- **Зарплата и установка планов → row card** (`import-salary-cards.mjs`): the KPI balances Linko stored for each salary
  record at its «Перерасчет KPI» (`staff/salary/<id>/` → `balances`: level, plan, sales, returns, fact, forecast, daily
  plan, bonus; one row per KPI and level of its bonus chain, each with that level's part of the bonus) go to
  `salary_kpi_balances`, which the record's card shows. Source: `salary_cards.json` (`{<linko salary id>: card}`,
  read-only captures of Linko's card pages, newest `backups/linko-raw/<date>/` that has it, or `RAW=<folder>`); a re-run
  replaces a record's rows with the newer copy. «Перерасчет KPI» in the app rewrites the rows of every record it
  recomputes (not a credited one) from its own engine, in the same shape (the card's balances are Linko's staff
  balances of the last recalculation, split by level, the daily plan unrounded).
- **Выполнения KPI**: Linko stores a snapshot per month (`staff/staff_balance`) when someone presses «Перерасчет» and
  never updates it. `import-kpi-balances.ts` (tsx, run by `run-all.sh` after the orders with their logs, returns,
  payments, visits and holidays it reads; the KPIs and employees must be in the database already) recomputes each
  stored month with the app's engine (`lib/kpi-performance-repo.ts`) as of Linko's recalculation moment, for the
  employees / KPIs / plans of Linko's snapshot — only those inputs are copied, never a fact or a bonus. It reads
  `staff_balance_months.json` and `kpi_last_date_months.json` (`fetch.mjs` step `months`) from the newest
  `backups/linko-raw/<date>/` that has both (`RAW=<folder>` for another, `DRY=1` only lists the months) and writes only
  `kpi_staff_balances` / `kpi_balance_dates`: salary records and their cards keep Linko's figures.
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
