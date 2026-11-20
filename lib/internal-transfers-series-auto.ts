import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { ensureTransfersSchema } from "@/lib/internal-transfers-repo"
import { productFacts, seriesOfProducts, productIdOfKey } from "@/lib/internal-transfers-series"
import { fifoOrder, seriesStock } from "@/lib/order-series-balance"
import type { TransferSeriesAutoType, TransferSeriesOption } from "@/lib/internal-transfers-types"

// «Авто распределение по сериям» and «Отменить автораспределение» of the transfer card (Linko's
// stock/stock_transfer/auto_set/ and auto_set_cancel/, which take a list of transfers).
//
// Linko's server rule cannot be observed read-only. A transfer line holds one series (Linko's
// stock_transfer_product.series), so Mezon distributes line by line from the series balances of the source warehouse
// (lib/order-series-balance.ts, the estimate the orders' distribution and Linko's series_balance use): the series are
// taken in the rule's order — FIFO the earliest expiry first, LIFO the latest, a series without an expiry last — and a
// line takes the first series whose available quantity covers it, else the first that has anything left; what a line
// takes is no longer available to the next lines (the transfers in id order, their lines in order). A transfer whose
// goods already left gives its own lines back first (the balance as it would be without it). A line no series has
// anything for keeps what it has. A line given a series is marked (items[].seriesAuto) and remembers the series it had
// (items[].seriesPrev: chosen in the form or copied from Linko); the cancel puts that back, or clears the series when
// there was none. Series only label the lines (no stock effect), so any status may be distributed, as Linko allows.

export class TransferSeriesError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message)
  }
}

export const TRANSFER_SERIES_AUTO_TYPES: TransferSeriesAutoType[] = ["fifo", "lifo"]

const EPS = 1e-9
const round9 = (value: number) => Math.round(value * 1e9) / 1e9

type RawLine = Record<string, unknown>

/** The stored lines (objects only, as parseItems keeps them) and a writer that puts changed lines back in place. */
function storedLines(text: string): { lines: RawLine[]; write: (lines: RawLine[]) => string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text || "[]")
  } catch {
    parsed = []
  }
  const all = Array.isArray(parsed) ? parsed : []
  const lines = all.filter((line): line is RawLine => Boolean(line) && typeof line === "object")
  return {
    lines,
    write: (next) => {
      let position = 0
      return JSON.stringify(all.map((line) => (line && typeof line === "object" ? next[position++] : line)))
    },
  }
}

/** The series of a product in the rule's order. */
function inOrder(series: TransferSeriesOption[], lifo: boolean): TransferSeriesOption[] {
  const ordered = fifoOrder(series.map((option) => ({ ...option, expiration_date: option.expirationDate })))
  return lifo ? ordered.reverse() : ordered
}

type Row = { id: number; items: string; from_warehouse: string; status: string }

async function lockRows(tx: PgDb, ids: number[]): Promise<Row[]> {
  const rows = (await tx.prepare("SELECT id, items, from_warehouse, status FROM internal_transfers WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE").all({ ids })) as Row[]
  if (rows.length !== ids.length) throw new TransferSeriesError("Передача не найдена", 404)
  return rows
}

const save = (tx: PgDb, id: number, items: string) => tx.prepare("UPDATE internal_transfers SET items = @items, updated_at = datetime('now') WHERE id = @id").run({ id, items })

const qtyOf = (line: RawLine) => {
  const value = Number(String(line.quantity ?? 0).replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

/** POST /api/internal-transfers/series/auto. `unassigned`: the quantity of the lines no series had anything for. */
export async function autoDistributeTransferSeries(ids: number[], type: TransferSeriesAutoType): Promise<{ transfers: number; lines: number; unassigned: number }> {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (!unique.length) throw new TransferSeriesError("Выберите передачи", 400)
  if (!TRANSFER_SERIES_AUTO_TYPES.includes(type)) throw new TransferSeriesError("Неверные данные", 400)
  await ensureTransfersSchema()
  return withTransaction(async (tx) => {
    const rows = await lockRows(tx, unique)
    const parsed = rows.map((row) => ({ id: Number(row.id), warehouse: String(row.from_warehouse ?? "").trim(), moved: row.status === "в пути" || row.status === "принят", ...storedLines(row.items) }))
    const keys = parsed.flatMap((row) => row.lines.map((line) => String(line.key ?? "")))
    const facts = await productFacts(tx, keys)
    const tracked = (line: RawLine) => {
      const key = String(line.key ?? "")
      return productIdOfKey(key) !== null && Boolean(facts.get(key)?.trackExpiry) && qtyOf(line) > 0
    }
    const productIds = [...new Set(parsed.flatMap((row) => row.lines.filter(tracked).map((line) => productIdOfKey(String(line.key))!)))]
    const catalog = await seriesOfProducts(tx, productIds)
    const requests = parsed.flatMap((row) => (row.warehouse ? row.lines.filter(tracked).map((line) => ({ productId: productIdOfKey(String(line.key))!, warehouse: row.warehouse })) : []))
    const stock = await seriesStock(tx, requests)
    // What is left of each series in each source warehouse while the lines draw from it.
    const left = new Map<string, number>()
    for (const [key, bySeries] of stock) for (const [seriesId, balance] of bySeries) left.set(`${key}|${seriesId}`, Math.max(0, balance.available))
    // A transfer whose goods left took its own lines out of the series they name: they are available to it again.
    for (const row of parsed) {
      if (!row.moved || !row.warehouse) continue
      for (const line of row.lines.filter(tracked)) {
        const seriesId = Number(line.seriesId)
        const productId = productIdOfKey(String(line.key))!
        if (!catalog.some((option) => option.id === seriesId && option.productId === productId)) continue
        const key = `${row.warehouse}|${productId}|${seriesId}`
        left.set(key, round9((left.get(key) ?? 0) + qtyOf(line)))
      }
    }
    let written = 0
    let unassigned = 0
    for (const row of parsed) {
      let changed = false
      const next = row.lines.map((line) => {
        if (!tracked(line)) return line
        const productId = productIdOfKey(String(line.key))!
        const quantity = qtyOf(line)
        const ordered = inOrder(
          catalog.filter((option) => option.productId === productId),
          type === "lifo",
        )
        const available = (option: TransferSeriesOption) => (row.warehouse ? (left.get(`${row.warehouse}|${productId}|${option.id}`) ?? 0) : 0)
        const series = ordered.find((option) => available(option) >= quantity - EPS) ?? ordered.find((option) => available(option) > EPS)
        if (!series) {
          unassigned = round9(unassigned + quantity)
          return line
        }
        const key = `${row.warehouse}|${productId}|${series.id}`
        left.set(key, round9(Math.max(0, available(series) - quantity)))
        written++
        // The series the line had before the distribution: kept from an earlier distribution, else the line's own.
        const own = line.seriesAuto === true ? line.seriesPrev : Number(line.seriesId) > 0 || String(line.series ?? "").trim() ? { ...(Number(line.seriesId) > 0 ? { id: Number(line.seriesId) } : {}), series: String(line.series ?? "") } : undefined
        const nextLine: RawLine = { ...line, series: series.displayName, seriesId: series.id, seriesAuto: true }
        delete nextLine.seriesPrev
        if (own && typeof own === "object") nextLine.seriesPrev = own
        changed ||= JSON.stringify(nextLine) !== JSON.stringify(line)
        return nextLine
      })
      if (changed) await save(tx, row.id, row.write(next))
    }
    return { transfers: unique.length, lines: written, unassigned }
  })
}

/** POST /api/internal-transfers/series/auto-cancel: every line the distribution gave a series gets back the one it had
 * (or none). */
export async function cancelTransferAutoSeries(ids: number[]): Promise<{ transfers: number; lines: number }> {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (!unique.length) throw new TransferSeriesError("Выберите передачи", 400)
  await ensureTransfersSchema()
  return withTransaction(async (tx) => {
    let restored = 0
    for (const row of await lockRows(tx, unique)) {
      const { lines, write } = storedLines(row.items)
      let changed = false
      const next = lines.map((line) => {
        if (line.seriesAuto !== true) return line
        changed = true
        restored++
        const prev = line.seriesPrev && typeof line.seriesPrev === "object" ? (line.seriesPrev as { id?: unknown; series?: unknown }) : null
        const rest: RawLine = { ...line }
        delete rest.seriesId
        delete rest.seriesAuto
        delete rest.seriesPrev
        const prevId = Number(prev?.id)
        return { ...rest, series: String(prev?.series ?? ""), ...(Number.isSafeInteger(prevId) && prevId > 0 ? { seriesId: prevId } : {}) }
      })
      if (changed) await save(tx, Number(row.id), write(next))
    }
    return { transfers: unique.length, lines: restored }
  })
}
