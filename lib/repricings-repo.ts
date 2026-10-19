import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { findItemPrice, setItemPrices } from "@/lib/item-prices"
import { dependentPriceLists, priceListsByIds } from "@/lib/price-lists-repo"
import { recordLinkedRepricing } from "@/lib/linked-repricings-repo"
import { availableByKey, itemNames, repricingCatalog } from "@/lib/repricings-items"
import {
  MONTHS,
  RepricingError,
  STATUS_DB,
  detailOf,
  docTotals,
  ensureRepricingsSchema,
  parseLines,
  readRow,
  statusOf,
  type StoredLine,
} from "@/lib/repricings-read"
import { calcLinkedPrice, type PriceList } from "@/components/analytics/price-lists-data"
import type { RepricingCreateResult, RepricingDetail, RepricingItemKind, RepricingSource } from "@/components/analytics/repricing-data"

export {
  REPRICING_SORT_KEYS,
  RepricingError,
  ensureRepricingsSchema,
  getRepricing,
  listRepricings,
  listRepricingsPage,
  repricingErrorResponse,
  repricingOptions,
  type RepricingListQuery,
} from "@/lib/repricings-read"

// "Переоценка" (demo #/revaluation, chunk c143, API main/reprice/). A document sets new prices of
// items in ONE price list; saving it finishes it ("проведен") and writes the prices through
// lib/item-prices.ts in the same transaction. Each line keeps the item's previous entry, so
// cancelling ("отменен", demo DELETE main/reprice/:id/) restores the old prices — refused (409)
// when a later finished repricing of the same price list touched one of the items.
//   * "Сумма переоценки" = Σ (new − old) × Кол-во, Кол-во = available stock (stock core) when saved
//     or at the last "Перерасчет по текущей дате" (demo PUT main/reprice/:id/recalc/);
//   * linked price lists (price_lists.linked_list + calc method) get their own documents: from the
//     create dialog ("Создать переоценку для связанных прайс-листов") with the new prices, or from
//     "Переоценку связанных" (demo POST main/reprice/connected/) with the current prices; chains of
//     links are followed.
// Rows written by a supply's "Наценка" (lib/supplier-incomings-repo.ts: one product per row,
// product_id + amount = new price, items '[]') are read as one-line documents without old price.

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function lockRepricings(db: PgDb) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:repricings'))").get()
}

function dateLabel(now = new Date()): string {
  const local = new Date(now.getTime() + 5 * 3600_000).toISOString()
  return `${local.slice(8, 10)} ${MONTHS[Number(local.slice(5, 7)) - 1]} ${local.slice(0, 4)}`
}

type PriceTarget = { kind: RepricingItemKind; id: number; price: number }

/** Applies prices to one list and returns the lines (unchanged prices are dropped when `skipUnchanged`). */
async function applyPrices(
  tx: PgDb,
  list: Pick<PriceList, "name" | "currency">,
  currency: string,
  targets: PriceTarget[],
  available: Map<string, number>,
  skipUnchanged: boolean,
): Promise<{ lines: StoredLine[]; missing: string[] }> {
  const lines: StoredLine[] = []
  const missing: string[] = []
  const units = await itemNames(tx, targets.map((target) => `${target.kind}:${target.id}`))
  // Fixed order (kind, id) so concurrent price writers lock the item rows in the same order.
  const ordered = [...targets].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "product" ? -1 : 1))
  for (const target of ordered) {
    const key = `${target.kind}:${target.id}`
    const result = await setItemPrices(tx, target.kind, target.id, [{ priceList: list.name, cash: target.price, nonCash: target.price, currency, nonCashCurrency: currency }])
    if (!result) {
      missing.push(key)
      continue
    }
    const previous = result.previous[0]
    if (skipUnchanged && !result.changed) continue
    lines.push({
      kind: target.kind,
      id: target.id,
      key,
      name: result.name,
      product: result.name,
      unit: units.get(key)?.unit ?? "",
      amount: available.get(key) ?? 0,
      oldPrice: previous ? previous.cash : 0,
      oldCurrency: normCurrency(previous?.currency, list.currency),
      price: target.price,
      oldEntry: previous,
    })
  }
  // Show the lines in the order they were entered.
  const position = new Map(targets.map((target, index) => [`${target.kind}:${target.id}`, index]))
  lines.sort((a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0))
  return { lines, missing }
}

async function insertDoc(
  tx: PgDb,
  doc: { priceListId: number; currency: string; comment: string; lines: StoredLine[]; user: string; source: RepricingSource; parentId: number | null },
): Promise<number> {
  const totals = docTotals(doc.lines)
  const result = await tx
    .prepare(
      `INSERT INTO repricings (created_by, created_at_label, price_list_id, product_id, amount, currency, status, "user", items, comment,
         total, total_old, total_new, source, parent_id, created_at, updated_at)
       VALUES (@user, @label, @priceListId, NULL, @total::double precision, @currency, '${STATUS_DB.finished}', @user, @items, @comment,
         @total::double precision, @totalOld::double precision, @totalNew::double precision, @source, @parentId::int, datetime('now'), datetime('now'))`,
    )
    .run({
      user: doc.user,
      label: dateLabel(),
      priceListId: doc.priceListId,
      currency: normCurrency(doc.currency),
      items: JSON.stringify(doc.lines),
      comment: doc.comment,
      source: doc.source,
      parentId: doc.parentId,
      ...totals,
    })
  return Number(result.lastInsertRowid)
}

type LinkedOutcome = { ids: number[]; skipped: Array<{ priceList: string; reason: string }> }

/**
 * Reprices the lists linked to `source` from the given source prices (their calc method), then the
 * lists linked to those, and so on (each list once).
 */
async function repriceDependents(
  tx: PgDb,
  source: Pick<PriceList, "id" | "name">,
  sourcePrices: PriceTarget[],
  available: Map<string, number>,
  user: string,
  comment: string,
  parentId: number | null,
  visited: Set<number>,
  outcome: LinkedOutcome,
): Promise<void> {
  visited.add(source.id)
  for (const target of await dependentPriceLists(tx, source.name)) {
    if (visited.has(target.id)) continue
    const docId = await repriceLinkedList(tx, target, sourcePrices, available, user, comment, parentId, outcome)
    if (!target.calcMethodId) continue
    // The target's prices feed the lists linked to it (even when they did not change, a stale
    // list further down the chain is brought up to date).
    const nextPrices = sourcePrices.flatMap((price) => {
      const value = calcLinkedPrice(price.price, target.calcMethodId, target.methodValues)
      return value === null ? [] : [{ ...price, price: value }]
    })
    await repriceDependents(tx, target, nextPrices, available, user, comment, docId ?? parentId, visited, outcome)
  }
}

/** One linked list from source prices; returns the new document id or null (skipped). */
async function repriceLinkedList(
  tx: PgDb,
  target: PriceList,
  sourcePrices: PriceTarget[],
  available: Map<string, number>,
  user: string,
  comment: string,
  parentId: number | null,
  outcome: LinkedOutcome,
): Promise<number | null> {
  if (!target.calcMethodId) {
    outcome.skipped.push({ priceList: target.name, reason: "Не указан метод расчета" })
    return null
  }
  const targets = sourcePrices
    .map((price) => ({ ...price, price: calcLinkedPrice(price.price, target.calcMethodId, target.methodValues) }))
    .filter((price): price is PriceTarget => price.price !== null)
  const { lines } = await applyPrices(tx, target, target.currency, targets, available, true)
  if (!lines.length) {
    outcome.skipped.push({ priceList: target.name, reason: "Цены не изменились" })
    return null
  }
  const id = await insertDoc(tx, { priceListId: target.id, currency: target.currency, comment, lines, user, source: "connected", parentId })
  outcome.ids.push(id)
  return id
}

export type RepricingInput = {
  priceListId: number
  currency: string
  comment: string
  products: PriceTarget[]
  connected: boolean
}

/**
 * Writes one finished repricing inside the CALLER's transaction and applies its prices (+ linked
 * lists when `connected`). For other modules that reprice as part of their own document, e.g. a
 * supply's "Наценка": `await ensureRepricingsSchema()` and `available = await availableByKey()`
 * BEFORE opening the transaction, then call this with the transaction handle. Returns the new id.
 */
export async function createRepricingTx(
  tx: PgDb,
  input: RepricingInput,
  user: string,
  available: Map<string, number>,
  source: RepricingSource = "manual",
): Promise<{ id: number; linkedIds: number[]; skipped: LinkedOutcome["skipped"] }> {
  await lockRepricings(tx)
  const [list] = await priceListsByIds(tx, [input.priceListId])
  if (!list) throw new RepricingError("Прайс-лист не найден")
  const unique = new Map<string, PriceTarget>()
  for (const product of input.products) unique.set(`${product.kind}:${product.id}`, product)
  if (!unique.size) throw new RepricingError("Добавьте товары")
  const currency = normCurrency(input.currency, list.currency)
  const { lines, missing } = await applyPrices(tx, list, currency, [...unique.values()], available, false)
  if (missing.length) throw new RepricingError("Товар не найден", 400, { missing })
  const id = await insertDoc(tx, { priceListId: list.id, currency, comment: input.comment, lines, user, source, parentId: null })
  const outcome: LinkedOutcome = { ids: [], skipped: [] }
  if (input.connected) await repriceDependents(tx, list, [...unique.values()], available, user, input.comment, id, new Set(), outcome)
  return { id, linkedIds: outcome.ids, skipped: outcome.skipped }
}

/** Demo POST main/reprice/: creates a finished repricing and applies its prices (+ linked lists). */
export async function createRepricing(input: RepricingInput, user: string): Promise<RepricingCreateResult> {
  await ensureRepricingsSchema()
  const available = await availableByKey()
  return withTransaction(async (tx) => {
    const { id, linkedIds, skipped } = await createRepricingTx(tx, input, user, available)
    const repricing = await detailOf(tx, (await readRow(tx, id))!)
    const linked = await Promise.all(linkedIds.map(async (linkedId) => detailOf(tx, (await readRow(tx, linkedId))!)))
    return { repricing, linked, skipped }
  })
}

/**
 * "Переоценку связанных" (demo POST main/reprice/connected/ {price_list}): reprices the lists linked
 * to the chosen one from its CURRENT prices (and their own linked lists); when the chosen list is
 * itself linked, it is first recomputed from its connected list.
 */
export async function createConnectedRepricings(priceListId: number, user: string): Promise<RepricingCreateResult> {
  await ensureRepricingsSchema()
  const available = await availableByKey()
  const result = await withTransaction(async (tx) => {
    await lockRepricings(tx)
    const [list] = await priceListsByIds(tx, [priceListId])
    if (!list) throw new RepricingError("Прайс-лист не найден")
    const dependents = await dependentPriceLists(tx, list.name)
    if (!dependents.length && !list.connectedPriceList) throw new RepricingError("У прайс-листа нет связанных прайс-листов")
    const pricesOf = (catalog: Awaited<ReturnType<typeof repricingCatalog>>, name: string): PriceTarget[] =>
      catalog.flatMap((item) => {
        const entry = findItemPrice(item.entries, name)
        return entry ? [{ kind: item.kind, id: item.id, price: entry.cash }] : []
      })
    let catalog = await repricingCatalog(tx)
    const outcome: LinkedOutcome = { ids: [], skipped: [] }
    const visited = new Set<number>()
    let parentId: number | null = null
    if (list.connectedPriceList) {
      // The chosen list is itself linked: recompute it from its connected list first.
      visited.add(list.connectedPriceList.id)
      parentId = await repriceLinkedList(tx, list, pricesOf(catalog, list.connectedPriceList.name), available, user, "", null, outcome)
      if (parentId !== null) catalog = await repricingCatalog(tx)
    }
    await repriceDependents(tx, list, pricesOf(catalog, list.name), available, user, "", parentId, visited, outcome)
    const linked = await Promise.all(outcome.ids.map(async (id) => detailOf(tx, (await readRow(tx, id))!)))
    return { priceList: list, repricing: null, linked, skipped: outcome.skipped }
  })
  await recordLinkedRepricing({ priceListId: result.priceList.id, priceListName: result.priceList.name, repricingIds: result.linked.map((doc) => doc.id) }, user)
  return { repricing: result.repricing, linked: result.linked, skipped: result.skipped }
}

/** Cancel ("отменен", demo DELETE main/reprice/:id/): restores the previous prices of every line. */
export async function cancelRepricing(id: number, user: string): Promise<RepricingDetail | null> {
  await ensureRepricingsSchema()
  return withTransaction(async (tx) => {
    await lockRepricings(tx)
    const row = await readRow(tx, id, true)
    if (!row) return null
    if (statusOf(row.status) === "canceled") throw new RepricingError("Переоценка уже отменена")
    const lines = parseLines(row)
    if (lines.some((line) => line.legacy || line.oldEntry === undefined)) throw new RepricingError("Отмена невозможна: старые цены не сохранены", 409)
    const [list] = row.price_list_id === null ? [] : await priceListsByIds(tx, [Number(row.price_list_id)])
    if (!list) throw new RepricingError("Прайс-лист не найден", 409)
    // A later finished repricing of the same price list that touched one of the items wins.
    const keys = lines.map((line) => line.key)
    const later = (await tx
      .prepare(
        `SELECT r.id FROM repricings r
          WHERE r.id > @id AND r.price_list_id = @priceListId AND r.status <> '${STATUS_DB.canceled}'
            AND (('product:' || r.product_id) = ANY(@keys::text[])
                 OR (r.items LIKE '[%' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.items::jsonb) e WHERE e->>'key' = ANY(@keys::text[]))))
          ORDER BY r.id`,
      )
      .all({ id, priceListId: row.price_list_id, keys })) as Array<{ id: number }>
    if (later.length) {
      throw new RepricingError("Отмена невозможна: позже проведена переоценка этих товаров", 409, { conflicts: later.map((item) => Number(item.id)) })
    }
    const ordered = [...lines].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "product" ? -1 : 1))
    for (const line of ordered) {
      const old = line.oldEntry
      await setItemPrices(
        tx,
        line.kind,
        Number(line.id),
        old
          ? [{ priceList: list.name, cash: old.cash, nonCash: old.nonCash, currency: old.currency, nonCashCurrency: old.nonCashCurrency }]
          : [{ priceList: list.name, remove: true }],
      )
    }
    await tx
      .prepare(`UPDATE repricings SET status = '${STATUS_DB.canceled}', canceled_at = datetime('now'), canceled_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(user, id)
    return detailOf(tx, (await readRow(tx, id))!)
  })
}

/** "Перерасчет по текущей дате" (demo PUT main/reprice/:id/recalc/): quantities and sums at the current moment. */
export async function recalcRepricing(id: number): Promise<RepricingDetail | null> {
  await ensureRepricingsSchema()
  const available = await availableByKey()
  return withTransaction(async (tx) => {
    const row = await readRow(tx, id, true)
    if (!row) return null
    const lines = parseLines(row).map((line) => ({ ...line, amount: available.get(line.key) ?? 0 }))
    const totals = docTotals(lines)
    await tx
      .prepare(
        `UPDATE repricings SET items = @items, total = @total::double precision, total_old = @totalOld::double precision,
           total_new = @totalNew::double precision, amount = CASE WHEN product_id IS NULL THEN @total::double precision ELSE amount END,
           source = CASE WHEN source = '' AND product_id IS NOT NULL THEN 'supplier_incoming' ELSE source END,
           recalculated_at = datetime('now'), updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ id, items: JSON.stringify(lines), ...totals })
    return detailOf(tx, (await readRow(tx, id))!)
  })
}
