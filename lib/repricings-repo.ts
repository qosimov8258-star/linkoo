import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { convertAmount, normCurrency } from "@/lib/finance/currency"
import { findItemPrice, INVALID_PRICE, isValidPrice, setItemPrices } from "@/lib/item-prices"
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
  type RateMap,
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
// Only live items are repriced ("Удалённые" ones are "Товар не найден"). Cancelling a document also
// cancels the linked documents derived from it (parent_id chain), deepest first, in the same
// transaction — the linked lists go back too.
// Currencies: a document is in its price list's currency and writes the prices in it. A manual
// document in another currency is refused (400 CURRENCY_MISMATCH); a supply's "Наценка" in another
// currency is converted into the list's currency with the current rates (400 RATE_UNKNOWN without a
// rate). A linked list is computed from the source list's price IN THE SOURCE LIST'S CURRENCY (an
// entry kept in another currency is converted first): "Умножить на курс" multiplies it by the
// list's own rate (that is how a list in another currency follows); the other methods work in the
// linked list's currency, so a source price in another currency is converted with the current rates
// first (without a rate the list is skipped with "Не указан курс валюты"). Every sum
// (Σ (new − old) × Кол-во) is in the document currency: an old price in another currency is
// converted with the rate kept on the line (StoredLine.oldRate).

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

export const CURRENCY_NOT_FOUND = "Валюта не найдена"
export const CURRENCY_MISMATCH = "Валюта переоценки должна совпадать с валютой прайс-листа"
export const RATE_UNKNOWN = "Не указан курс валюты"

/** Units of `to` per 1 unit of `from` with the current rates (1 for the same currency; null = no rate). */
function rateBetween(from: string, to: string, rates: RateMap): number | null {
  return convertAmount(1, from, to, rates)
}

/**
 * Applies prices (in the list's currency) to one list and returns the lines (unchanged prices are
 * dropped when `skipUnchanged`). Each line keeps the rate that puts its old price into the list's
 * currency (the old entry may be kept in another currency).
 */
async function applyPrices(
  tx: PgDb,
  list: Pick<PriceList, "name" | "currency">,
  targets: PriceTarget[],
  available: Map<string, number>,
  skipUnchanged: boolean,
  rates: RateMap,
): Promise<{ lines: StoredLine[]; missing: string[] }> {
  const currency = normCurrency(list.currency)
  const lines: StoredLine[] = []
  const missing: string[] = []
  const units = await itemNames(tx, targets.map((target) => `${target.kind}:${target.id}`))
  // Fixed order (kind, id) so concurrent price writers lock the item rows in the same order.
  const ordered = [...targets].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "product" ? -1 : 1))
  for (const target of ordered) {
    const key = `${target.kind}:${target.id}`
    const result = await setItemPrices(
      tx,
      target.kind,
      target.id,
      [{ priceList: list.name, cash: target.price, nonCash: target.price, currency, nonCashCurrency: currency }],
      { live: true },
    )
    if (!result) {
      missing.push(key)
      continue
    }
    const previous = result.previous[0]
    if (skipUnchanged && !result.changed) continue
    const oldCurrency = normCurrency(previous?.currency, currency)
    lines.push({
      kind: target.kind,
      id: target.id,
      key,
      name: result.name,
      product: result.name,
      unit: units.get(key)?.unit ?? "",
      amount: available.get(key) ?? 0,
      oldPrice: previous ? previous.cash : 0,
      oldCurrency,
      oldRate: rateBetween(oldCurrency, currency, rates),
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
  const totals = docTotals(doc.lines, doc.currency)
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

/** Context of one run over linked lists: the stock weights, who / why, the current rates. */
type LinkedRun = { available: Map<string, number>; user: string; comment: string; rates: RateMap; outcome: LinkedOutcome }

type SourceList = Pick<PriceList, "id" | "name" | "currency">

/**
 * Reprices the lists linked to `source` from the given source prices (IN THE SOURCE LIST'S
 * CURRENCY; see linkedPrices), then the lists linked to those, and so on (each list once).
 */
async function repriceDependents(tx: PgDb, source: SourceList, sourcePrices: PriceTarget[], parentId: number | null, visited: Set<number>, run: LinkedRun): Promise<void> {
  visited.add(source.id)
  for (const target of await dependentPriceLists(tx, source.name)) {
    if (visited.has(target.id)) continue
    const docId = await repriceLinkedList(tx, source, target, sourcePrices, parentId, run)
    const prices = target.calcMethodId ? linkedPrices(source, target, sourcePrices, run.rates) : null
    if (!prices) continue
    // The target's prices feed the lists linked to it (even when they did not change, a stale
    // list further down the chain is brought up to date).
    await repriceDependents(tx, target, prices, docId ?? parentId, visited, run)
  }
}

/**
 * Prices of a linked list (its currency) from its source list's prices (the source list's
 * currency). "Умножить на курс" is itself the conversion between the two lists' currencies (the
 * user's rate); every other method (percent, amount, "same") works in the target list's currency,
 * so a source price in another currency is first converted with the current rates. null = no rate
 * between the two currencies (the list cannot be computed).
 */
function linkedPrices(source: Pick<PriceList, "currency">, target: PriceList, sourcePrices: PriceTarget[], rates: RateMap): PriceTarget[] | null {
  const from = normCurrency(source.currency)
  const to = normCurrency(target.currency)
  const factor = from === to || target.calcMethodId === "rate" ? 1 : rateBetween(from, to, rates)
  if (factor === null) return null
  return sourcePrices.flatMap((price) => {
    const value = calcLinkedPrice(price.price * factor, target.calcMethodId, target.methodValues)
    return value === null ? [] : [{ ...price, price: value }]
  })
}

/** One linked list from source prices (the source list's currency); returns the new document id or null (skipped). */
async function repriceLinkedList(tx: PgDb, source: SourceList, target: PriceList, sourcePrices: PriceTarget[], parentId: number | null, run: LinkedRun): Promise<number | null> {
  if (!target.calcMethodId) {
    run.outcome.skipped.push({ priceList: target.name, reason: "Не указан метод расчета" })
    return null
  }
  const prices = linkedPrices(source, target, sourcePrices, run.rates)
  if (!prices) {
    run.outcome.skipped.push({ priceList: target.name, reason: RATE_UNKNOWN })
    return null
  }
  const { lines } = await applyPrices(tx, target, prices, run.available, true, run.rates)
  if (!lines.length) {
    run.outcome.skipped.push({ priceList: target.name, reason: "Цены не изменились" })
    return null
  }
  const id = await insertDoc(tx, { priceListId: target.id, currency: target.currency, comment: run.comment, lines, user: run.user, source: "connected", parentId })
  run.outcome.ids.push(id)
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
  const context = await loadCurrencyContext(tx)
  const listCurrency = normCurrency(list.currency)
  const currency = normCurrency(input.currency, listCurrency)
  let targets = [...unique.values()]
  if (currency !== listCurrency) {
    if (!context.currencies.some((known) => known.code === currency)) throw new RepricingError(CURRENCY_NOT_FOUND)
    // The document (and every price it writes) is in the list's currency. Only a supply's
    // "Наценка" may bring prices in another currency: they are converted with the current rates.
    if (source !== "supplier_incoming") throw new RepricingError(CURRENCY_MISMATCH, 400, { currency: listCurrency })
    const rate = rateBetween(currency, listCurrency, context.rates)
    if (rate === null) throw new RepricingError(RATE_UNKNOWN, 400, { currency })
    targets = targets.map((target) => ({ ...target, price: Math.round(target.price * rate * 100) / 100 }))
    if (targets.some((target) => !isValidPrice(target.price))) throw new RepricingError(INVALID_PRICE)
  }
  const { lines, missing } = await applyPrices(tx, list, targets, available, false, context.rates)
  if (missing.length) throw new RepricingError("Товар не найден", 400, { missing })
  const id = await insertDoc(tx, { priceListId: list.id, currency: listCurrency, comment: input.comment, lines, user, source, parentId: null })
  const run: LinkedRun = { available, user, comment: input.comment, rates: context.rates, outcome: { ids: [], skipped: [] } }
  if (input.connected) await repriceDependents(tx, list, targets, id, new Set(), run)
  return { id, linkedIds: run.outcome.ids, skipped: run.outcome.skipped }
}

/** Demo POST main/reprice/: creates a finished repricing and applies its prices (+ linked lists). */
export async function createRepricing(input: RepricingInput, user: string): Promise<RepricingCreateResult> {
  await ensureRepricingsSchema()
  const available = await availableByKey()
  return withTransaction(async (tx) => {
    const { id, linkedIds, skipped } = await createRepricingTx(tx, input, user, available)
    const repricing = await detailOf(tx, (await readRow(tx, id))!)
    // One by one: a transaction client runs one query at a time.
    const linked: RepricingDetail[] = []
    for (const linkedId of linkedIds) linked.push(await detailOf(tx, (await readRow(tx, linkedId))!))
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
    const run: LinkedRun = { available, user, comment: "", rates: (await loadCurrencyContext(tx)).rates, outcome: { ids: [], skipped: [] } }
    // Current prices of a list in ITS currency: an entry kept in another currency is converted
    // with the current rates (without a rate the item is left out and the list says so).
    const pricesOf = (catalog: Awaited<ReturnType<typeof repricingCatalog>>, source: Pick<PriceList, "name" | "currency">): PriceTarget[] => {
      const currency = normCurrency(source.currency)
      let unconvertible = 0
      const prices = catalog.flatMap((item) => {
        const entry = findItemPrice(item.entries, source.name)
        if (!entry) return []
        const price = convertAmount(entry.cash, normCurrency(entry.currency, currency), currency, run.rates)
        if (price === null) {
          unconvertible += 1
          return []
        }
        return [{ kind: item.kind, id: item.id, price }]
      })
      if (unconvertible) run.outcome.skipped.push({ priceList: source.name, reason: RATE_UNKNOWN })
      return prices
    }
    let catalog = await repricingCatalog(tx)
    const visited = new Set<number>()
    let parentId: number | null = null
    if (list.connectedPriceList) {
      // The chosen list is itself linked: recompute it from its connected list first.
      visited.add(list.connectedPriceList.id)
      const [source] = await priceListsByIds(tx, [list.connectedPriceList.id])
      if (source) {
        parentId = await repriceLinkedList(tx, source, list, pricesOf(catalog, source), null, run)
        if (parentId !== null) catalog = await repricingCatalog(tx)
      }
    }
    await repriceDependents(tx, list, pricesOf(catalog, list), parentId, visited, run)
    const linked: RepricingDetail[] = []
    for (const id of run.outcome.ids) linked.push(await detailOf(tx, (await readRow(tx, id))!))
    return { priceList: list, repricing: null, linked, skipped: run.outcome.skipped }
  })
  await recordLinkedRepricing({ priceListId: result.priceList.id, priceListName: result.priceList.name, repricingIds: result.linked.map((doc) => doc.id) }, user)
  return { repricing: result.repricing, linked: result.linked, skipped: result.skipped }
}

/** The document and every linked document derived from it (parent_id chain), oldest first. */
async function documentTree(tx: PgDb, id: number): Promise<number[]> {
  const rows = (await tx
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM repricings WHERE id = @id
         UNION SELECT r.id FROM repricings r JOIN tree t ON r.parent_id = t.id
       )
       SELECT id FROM tree ORDER BY id`,
    )
    .all({ id })) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

/**
 * Cancel ("отменен", demo DELETE main/reprice/:id/): restores the previous prices of every line —
 * of this document and of the linked documents derived from it (their prices were computed from
 * this one), deepest first, all in one transaction. Refused (409, nothing changed) when a line has
 * no stored old price or a later finished repricing outside this tree touched one of the items.
 */
export async function cancelRepricing(id: number, user: string): Promise<RepricingDetail | null> {
  await ensureRepricingsSchema()
  return withTransaction(async (tx) => {
    await lockRepricings(tx)
    const row = await readRow(tx, id, true)
    if (!row) return null
    if (statusOf(row.status) === "canceled") throw new RepricingError("Переоценка уже отменена")
    const tree = await documentTree(tx, id)
    const docs: Array<{ id: number; lines: StoredLine[]; list: PriceList }> = []
    for (const docId of tree) {
      const doc = docId === id ? row : await readRow(tx, docId, true)
      if (!doc || statusOf(doc.status) === "canceled") continue
      const lines = parseLines(doc)
      if (lines.some((line) => line.legacy || line.oldEntry === undefined)) throw new RepricingError("Отмена невозможна: старые цены не сохранены", 409)
      const [list] = doc.price_list_id === null ? [] : await priceListsByIds(tx, [Number(doc.price_list_id)])
      if (!list) throw new RepricingError("Прайс-лист не найден", 409)
      docs.push({ id: docId, lines, list })
    }
    // A later finished repricing of the same price list that touched one of the items wins
    // (the documents being cancelled together do not count).
    const cancelling = docs.map((doc) => doc.id)
    const conflicts = new Set<number>()
    for (const doc of docs) {
      const later = (await tx
        .prepare(
          `SELECT r.id FROM repricings r
            WHERE r.id > @id AND r.price_list_id = @priceListId AND r.status <> '${STATUS_DB.canceled}' AND NOT (r.id = ANY(@cancelling::int[]))
              AND (('product:' || r.product_id) = ANY(@keys::text[])
                   OR (r.items LIKE '[%' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.items::jsonb) e WHERE e->>'key' = ANY(@keys::text[]))))
            ORDER BY r.id`,
        )
        .all({ id: doc.id, priceListId: doc.list.id, keys: doc.lines.map((line) => line.key), cancelling })) as Array<{ id: number }>
      for (const item of later) conflicts.add(Number(item.id))
    }
    if (conflicts.size) {
      throw new RepricingError("Отмена невозможна: позже проведена переоценка этих товаров", 409, { conflicts: [...conflicts].sort((a, b) => a - b) })
    }
    // Deepest (newest) documents first, so each list gets back the price it had before the chain.
    for (const doc of [...docs].reverse()) {
      const ordered = [...doc.lines].sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "product" ? -1 : 1))
      for (const line of ordered) {
        const old = line.oldEntry
        await setItemPrices(
          tx,
          line.kind,
          Number(line.id),
          old
            ? [{ priceList: doc.list.name, cash: old.cash, nonCash: old.nonCash, currency: old.currency, nonCashCurrency: old.nonCashCurrency }]
            : [{ priceList: doc.list.name, remove: true }],
        )
      }
      await tx
        .prepare(`UPDATE repricings SET status = '${STATUS_DB.canceled}', canceled_at = datetime('now'), canceled_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(user, doc.id)
    }
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
    const currency = normCurrency(row.currency)
    const { rates } = await loadCurrencyContext(tx)
    // A line whose old price is in another currency and has no kept rate (saved before rates were
    // kept, or there was no rate then) gets the current one, so the document's sums are in one
    // currency from now on (and its stored totals are no longer recomputed on read).
    const lines = parseLines(row).map((line): StoredLine => {
      const next = { ...line, amount: available.get(line.key) ?? 0 }
      if (line.legacy || line.oldPrice === null || line.oldPrice === undefined || typeof line.oldRate === "number") return next
      const rate = rateBetween(normCurrency(line.oldCurrency, currency), currency, rates)
      return rate === null ? next : { ...next, oldRate: rate }
    })
    const totals = docTotals(lines, currency, rates)
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
