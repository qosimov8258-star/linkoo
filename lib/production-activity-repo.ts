import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { parseAnyDate } from "@/lib/finance/dates"
import { lockWarehouseStock } from "@/lib/internal-transfers-stock"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import { insertMovements, refreshProductionCosts, type MovementItemInput } from "@/lib/production-batches-repo"
import { getProductionDb, itemKey, ProductionError, round, textKey, type ItemKind } from "@/lib/production-schema"
import { assertMovementDay, assertWarehouseOpen, ensureAvailable } from "@/lib/production-stock"
import { requireEntryEditable, sessionForEntry, sessionNames } from "@/lib/production-sessions-repo"
import { getStage, listRecipes, requireStageEquipment, resolveStageWorker } from "@/lib/production-stages-repo"
import { getWarehouseItemCosts, type WarehouseItemCosts } from "@/lib/stock/costs"
import { ensureWorkShiftsSchema } from "@/lib/work-shifts-repo"

/** Lazy tables the write transactions below reach, created before the transaction
 * opens. The cost ledger's install (first use after a start) runs its DDL on another
 * connection: started from inside a transaction that has already read those tables,
 * it would wait for that transaction's locks while the transaction waits for it. */
async function schemasBeforeTransaction(): Promise<void> {
  await getProductionDb()
  await ensureNetCostSchema()
}

/** `shifts`: any of these shift names; `direction`: the reference's «Тип» (Продукт = made, Сырьё = raw). */
export type ActivityFilters = { from: string; to: string; shifts?: string[]; equipmentId?: number; worker?: string; direction?: "made" | "raw" }

export type ActivityMadeLine = { key: string; name: string; unit: string; total: number; ok: number; defect: number }
export type ActivityRawLine = { key: string; name: string; unit: string; amount: number }

/** One record of «Записи»: a batch line (partyId) or a shift entry (partyId null, editable). No cost:
 * the activity tab shows quantities only. */
export type ActivityLog = {
  id: number
  partyId: number | null
  direction: "made" | "raw"
  key: string
  name: string
  unit: string
  amount: number
  isDefect: boolean
  /** The usage day the period filters on. */
  date: string
  /** When it was booked (ISO; a copied record keeps Linko's local time without a zone). */
  createdAt: string
  shift: string
  worker: string
  equipmentId: number | null
  equipmentName: string
  /** Who booked it («Создал»). */
  userName: string
  /** The worker's shift session it belongs to (null: booked outside any session). */
  sessionId: number | null
  /** Its session was handed over («Передать на склад»): it can no longer be changed («Уже передан»). */
  transferred: boolean
}

export type ProductionActivity = {
  made: ActivityMadeLine[]
  raw: ActivityRawLine[]
  /** Newest first. */
  logs: ActivityLog[]
  /** Filter choices beyond the Смены directory and the stage staff: every shift and worker already on the
   * stage's shift entries and shift sessions (so a renamed shift or a former staff member stays selectable). */
  options: { shifts: string[]; workers: string[] }
}

type LogRow = {
  id: number
  party_id: number | null
  direction: string
  item_kind: string
  item_id: number
  item_name: string
  unit: string
  amount: number
  is_defect: number
  date: string
  created_at: string | null
  shift: string | null
  worker: string | null
  equipment_id: number | null
  equipment_name: string | null
  user_name: string | null
  session_id: number | null
  transferred: boolean | null
}

/** Booking moment as the business wall time "YYYY-MM-DDTHH:mm:ss.ffffff" (comparable as text): the app stores UTC ISO
 * timestamps (milliseconds), records copied from Linko carry Linko's local time with an offset (microseconds) or
 * without a zone. The fraction keeps the order of lines booked within one second (one save books all its lines in
 * the same second), as the reference sorts them; a zone offset is whole minutes, so it never changes the fraction. */
const bookedAt = (value: string | null) => {
  const moment = parseAnyDate(value)
  if (!moment) return ""
  const fraction = /:\d{2}\.(\d+)/.exec(String(value ?? ""))?.[1] ?? ""
  return `${moment}.${fraction.slice(0, 6).padEnd(6, "0")}`
}

const uniqueNames = (values: Array<string | null | undefined>) => {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = String(value ?? "").trim()
    if (name && !seen.has(textKey(name))) seen.set(textKey(name), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
}

/** Everything the stage produced and consumed in a period — batch lines and shift
 * entries alike, cancelled batches excluded (cancelling a batch takes its stock effect
 * back). Records are newest first: the usage day, then the booking moment. */
export async function getActivity(stageId: number, filters: ActivityFilters): Promise<ProductionActivity> {
  const db = await getProductionDb()
  // The sessions' names join the Смены directory (lazy).
  await ensureWorkShiftsSchema()
  const where = [
    "m.stage_id = ?",
    "m.direction IN ('made', 'raw')",
    "m.date >= ?",
    "m.date <= ?",
    "(m.party_id IS NULL OR m.party_id IN (SELECT id FROM production_parties WHERE status <> 'cancelled'))",
  ]
  const params: unknown[] = [stageId, filters.from, filters.to]
  if (filters.direction) {
    where.push("m.direction = ?")
    params.push(filters.direction)
  }
  if (filters.equipmentId) {
    where.push("m.equipment_id = ?")
    params.push(filters.equipmentId)
  }
  const rows = (await db
    .prepare(
      `SELECT m.id, m.party_id, m.direction, m.item_kind, m.item_id, m.item_name, m.unit, m.amount, m.is_defect, m.date, m.created_at,
              m.shift, m.worker, m.equipment_id, e.name AS equipment_name, m.user_name, m.session_id,
              (ss.transfer_id IS NOT NULL AND tr.status IN ('потвержден', 'в пути', 'принят')) AS transferred
       FROM production_movements m LEFT JOIN production_equipment e ON e.id = m.equipment_id
       LEFT JOIN production_shift_sessions ss ON ss.id = m.session_id
       LEFT JOIN internal_transfers tr ON tr.id = ss.transfer_id
       WHERE ${where.join(" AND ")}`,
    )
    .all(...params)) as LogRow[]
  // Shift and worker match like the stored names do everywhere (case and spacing ignored).
  const shiftKeys = new Set((filters.shifts ?? []).map(textKey).filter(Boolean))
  const workerKey = textKey(filters.worker)
  const sorted: Array<{ log: ActivityLog; booked: string }> = rows
    .filter((row) => (!shiftKeys.size || shiftKeys.has(textKey(row.shift))) && (!workerKey || textKey(row.worker) === workerKey))
    .map((row) => ({
      booked: bookedAt(row.created_at),
      log: {
        id: Number(row.id),
        partyId: row.party_id === null || row.party_id === undefined ? null : Number(row.party_id),
        direction: row.direction === "made" ? ("made" as const) : ("raw" as const),
        key: itemKey(row.item_kind, row.item_id),
        name: row.item_name,
        unit: row.unit ?? "",
        amount: Number(row.amount) || 0,
        isDefect: Number(row.is_defect) === 1,
        date: row.date,
        createdAt: row.created_at ?? "",
        shift: (row.shift ?? "").trim(),
        worker: (row.worker ?? "").trim(),
        equipmentId: row.equipment_id === null || row.equipment_id === undefined ? null : Number(row.equipment_id),
        equipmentName: row.equipment_name ?? "",
        userName: (row.user_name ?? "").trim(),
        sessionId: row.session_id === null || row.session_id === undefined ? null : Number(row.session_id),
        transferred: row.transferred === true,
      },
    }))
  // Newest first: the usage day, then the booking moment (to the microsecond), the id only as the last tie-break.
  sorted.sort((a, b) => {
    if (a.log.date !== b.log.date) return a.log.date < b.log.date ? 1 : -1
    if (a.booked !== b.booked) return a.booked < b.booked ? 1 : -1
    return b.log.id - a.log.id
  })
  const logs = sorted.map((entry) => entry.log)

  const made = new Map<string, ActivityMadeLine>()
  const raw = new Map<string, ActivityRawLine>()
  for (const row of logs) {
    if (row.direction === "made") {
      const line = made.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, total: 0, ok: 0, defect: 0 }
      line.total = round(line.total + row.amount)
      if (row.isDefect) line.defect = round(line.defect + row.amount)
      else line.ok = round(line.ok + row.amount)
      made.set(row.key, line)
    } else {
      // «Затраченное сырье»: all raw the stage used, spoiled raw included, as the reference's write-off review
      // counts it (its page filter on a defect flag the review never sends keeps every row).
      const line = raw.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, amount: 0 }
      line.amount = round(line.amount + row.amount)
      raw.set(row.key, line)
    }
  }

  const used = (await db
    .prepare("SELECT DISTINCT shift, worker FROM production_movements WHERE stage_id = ? AND party_id IS NULL AND direction IN ('made', 'raw') AND (shift <> '' OR worker <> '')")
    .all(stageId)) as Array<{ shift: string | null; worker: string | null }>
  // «Смены» lists the stage's shift sessions (lib/production-sessions-repo.ts); their names are offered too.
  const sessions = await sessionNames(db, stageId)

  return {
    made: Array.from(made.values()),
    raw: Array.from(raw.values()),
    logs,
    options: {
      shifts: uniqueNames([...used.map((row) => row.shift), ...sessions.shifts]),
      workers: uniqueNames([...used.map((row) => row.worker), ...sessions.workers]),
    },
  }
}

export type ActivityInput = {
  direction: "made" | "raw"
  date: string
  /** A shift of the Смены directory (by id first, else by its name; "" / null = none). */
  shiftId: number | null
  shift: string
  equipmentId: number | null
  worker: string
  items: Array<MovementItemInput & { isDefect?: boolean }>
}

/** Refusals of a shift output line (R23): goods made without a recipe would come from nothing. */
export const NO_RECIPE_ERROR = "У товара нет рецепта на этом этапе"
export const EMPTY_RECIPE_ERROR = "В рецепте товара нет сырья"
export const SHIFT_NOT_FOUND = "Смена не найдена"

/** The shift of a shift entry, as the reference picks it: a shift of the Смены directory
 * (Настройки → Смены). By id first, else by name (case and spacing ignored: the id of that
 * name, then the same lock); anything else is refused (400). Returns the directory's name
 * ("" = no shift). The entry stores that name, so the row is read FOR SHARE inside the entry's
 * transaction (work_shifts exists by then: ensureWorkShiftsSchema before it): a rename of the
 * shift (which cascades into the entries) or its delete (which counts them) waits until the
 * entry is committed and then sees it; a shift deleted first is refused here. */
async function lockShift(tx: PgDb, shiftId: number | null, shift: string): Promise<{ id: number | null; name: string }> {
  if (!shiftId && !textKey(shift)) return { id: null, name: "" }
  let id = shiftId
  if (!id) {
    const directory = (await tx.prepare("SELECT id, name FROM work_shifts ORDER BY id").all()) as Array<{ id: number; name: string | null }>
    id = directory.find((entry) => textKey(entry.name) === textKey(shift))?.id ?? null
  }
  const row = id ? ((await tx.prepare("SELECT id, name FROM work_shifts WHERE id = ? FOR SHARE").get(id)) as { id: number; name: string | null } | undefined) : undefined
  if (!row) throw new ProductionError(400, SHIFT_NOT_FOUND, shiftId ? { shiftId } : { shift })
  return { id: Number(row.id), name: String(row.name ?? "").trim() }
}

/** Shift entries ("Добавить продукт" / "Добавить сырье" on the activity tab)
 * are not part of a batch; products made this way are costed by their recipe norms
 * on this stage at the components' cost of goods of that day (in the stage
 * warehouse), and keep those norms so the cost ledger re-values them when a
 * component's average of that day changes later. Output is only accepted for items
 * with a recipe on the stage (400 otherwise, as the activity tab only offers those),
 * and good output only when the recipe has raw material in it. Raw use must fit
 * the stage warehouse's available stock (409 otherwise). The shift must be one of the
 * Смены directory, the worker on the stage staff (stored under their canonical name)
 * and the machine one of the stage's — working or not, as the reference offers every
 * machine of the stage (400 otherwise). An entry of a worker with an open shift session
 * on the stage (for the entry's shift, or any when it names none; opened on or before the
 * entry's day) belongs to that session, and takes its shift when it names none. */
export async function addActivity(stageId: number, input: ActivityInput, userName: string): Promise<number | "stage_not_found"> {
  const stage = await getStage(stageId)
  if (!stage) return "stage_not_found"
  assertMovementDay(input.date)
  const recipes = input.direction === "made" ? await listRecipes(stageId) : []
  const recipeOf = (kind: ItemKind, id: number) => recipes.find((entry) => entry.kind === kind && entry.itemId === id)
  // The raw lines only: a norm's ready lines are what it puts out (the product itself, its by-products) and are never
  // consumed, so they neither cost the output nor count as its raw material («В рецепте товара нет сырья»).
  const normsOf = (recipe: NonNullable<ReturnType<typeof recipeOf>>) => {
    const norms = new Map<string, number>()
    for (const component of recipe.components) {
      if (component.role === "raw" && component.amount > 0) norms.set(component.key, (norms.get(component.key) ?? 0) + component.amount / recipe.amount)
    }
    return [...norms].map(([key, amount]) => ({ key, amount }))
  }
  if (input.direction === "made") {
    for (const line of input.items) {
      const recipe = recipeOf(line.kind, line.id)
      const key = itemKey(line.kind, line.id)
      if (!recipe || !(recipe.amount > 0)) throw new ProductionError(400, NO_RECIPE_ERROR, { key })
      if (!line.isDefect && !normsOf(recipe).length) throw new ProductionError(400, EMPTY_RECIPE_ERROR, { key })
    }
  }
  await schemasBeforeTransaction()
  await ensureWorkShiftsSchema()
  const result = await withTransaction(async (tx) => {
    // Lock order (C1): raw use takes stock — the stage warehouse's stock lock before any row lock.
    if (input.direction === "raw") await lockWarehouseStock(tx, [stage.warehouse])
    const shift = await lockShift(tx, input.shiftId, input.shift)
    await requireStageEquipment(tx, input.equipmentId, stageId)
    const worker = await resolveStageWorker(tx, stageId, input.worker)
    // The worker's open session (read FOR SHARE: a hand-over or close of it waits for this entry).
    const session = await sessionForEntry(tx, stageId, worker, shift.id, input.date)
    const shiftName = shift.name || session?.shiftName || ""
    let costs: WarehouseItemCosts | null = null
    const inserted = await insertMovements(
      tx,
      { stageId, partyId: null, warehouse: stage.warehouse, date: input.date, userName, shift: shiftName, equipmentId: input.equipmentId, worker, sessionId: session?.id ?? null },
      input.direction,
      input.items,
      async (item) => {
        const recipe = recipeOf(item.kind, item.id)
        if (!recipe || !(recipe.amount > 0)) throw new ProductionError(400, NO_RECIPE_ERROR, { key: item.key })
        const basis = normsOf(recipe)
        costs ??= await getWarehouseItemCosts({ date: input.date }, tx)
        const cost = basis.reduce((sum, line) => sum + line.amount * (costs?.costOf(line.key, stage.warehouse) ?? 0), 0)
        return { cost, basis }
      },
    )
    return inserted
  })
  // The products.cost cache of the items (and what is made of them) follows the committed booking (logs, never throws).
  if (result > 0) await refreshProductionCosts(input.items.map((item) => itemKey(item.kind, item.id)))
  return result
}

// ---------------------------------------------------------------------------
// «Записи» row actions: «Изменить» (the amount) and «Удалить» of a shift entry
// ---------------------------------------------------------------------------

type EntryRow = {
  id: number
  party_id: number | null
  stage_id: number | null
  direction: string
  item_kind: string
  item_id: number
  item_name: string
  unit: string
  amount: number
  is_defect: number
  warehouse: string
  date: string
  in_stock: number | null
  session_id: number | null
}

/** The warehouse of the entry was renamed between the unlocked read and its stock lock. */
class EntryWarehouseMoved extends Error {}

/** Runs `fn` on a shift entry (a stage's made / raw line outside any batch) in one transaction,
 * with the lock order of every stock writer (C1): the warehouse's stock lock first, then the
 * row (FOR UPDATE). The warehouse is read without a lock first; when a rename lands in between,
 * the transaction rolls back and runs again with the new name. Batch lines, inventory
 * adjustments and unknown ids are "not_found" here (a batch line is changed in its batch); an
 * entry of a handed-over shift session is refused (409 «Уже передан»). */
async function withShiftEntry(id: number, fn: (tx: PgDb, row: EntryRow) => Promise<void>): Promise<"ok" | "not_found"> {
  await schemasBeforeTransaction()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTransaction(async (tx) => {
        const peek = (await tx.prepare("SELECT warehouse FROM production_movements WHERE id = ?").get(id)) as { warehouse: string } | undefined
        if (!peek) return "not_found"
        await lockWarehouseStock(tx, [peek.warehouse])
        const row = (await tx
          .prepare(
            `SELECT id, party_id, stage_id, direction, item_kind, item_id, item_name, unit, amount, is_defect, warehouse, date, COALESCE(in_stock, 1) AS in_stock,
                    session_id
             FROM production_movements WHERE id = ? FOR UPDATE`,
          )
          .get(id)) as EntryRow | undefined
        if (!row || row.party_id !== null || row.stage_id === null || (row.direction !== "made" && row.direction !== "raw")) return "not_found"
        if (textKey(row.warehouse) !== textKey(peek.warehouse)) throw new EntryWarehouseMoved()
        // An entry of a handed-over session stays as it was handed over (Linko: «Уже передан»). The session is read
        // FOR SHARE after the warehouse lock, the order «Передать на склад» takes them in.
        await requireEntryEditable(tx, row.session_id)
        await fn(tx, row)
        return "ok"
      })
    } catch (error) {
      if (!(error instanceof EntryWarehouseMoved)) throw error
    }
  }
  throw new ProductionError(503, "Не удалось выполнить запрос")
}

/** The stock a change of a shift entry takes out of its warehouse (qty > 0), checked on
 * every day from the entry's day on (no day may go negative, 409 otherwise): more raw used,
 * or output (good or brak units) that is no longer there. */
async function requireEntryStock(tx: PgDb, row: EntryRow, takenOut: number, prefix: string): Promise<void> {
  if (!(takenOut > 0) || Number(row.in_stock ?? 1) === 0 || !textKey(row.warehouse)) return
  await ensureAvailable(
    tx,
    row.warehouse,
    [
      {
        key: itemKey(row.item_kind, row.item_id),
        name: row.item_name,
        unit: row.unit,
        qty: round(takenOut),
        date: row.date,
        // Removing brak output takes defective units; raw always took good ones.
        defect: row.direction === "made" && Number(row.is_defect) === 1,
      },
    ],
    prefix,
  )
}

/** «Изменить»: the new amount of a shift entry. Raw used above the old amount must still be
 * in stock, and output below it must still be in the warehouse (409 otherwise). */
export async function updateActivityAmount(id: number, amount: number): Promise<"ok" | "not_found"> {
  let key = ""
  const result = await withShiftEntry(id, async (tx, row) => {
    key = itemKey(row.item_kind, row.item_id)
    const delta = round(amount - (Number(row.amount) || 0))
    if (!delta) return
    await assertWarehouseOpen(tx, row.warehouse)
    await requireEntryStock(tx, row, row.direction === "raw" ? delta : -delta, "Не возможно изменить. ")
    await tx.prepare("UPDATE production_movements SET amount = ? WHERE id = ?").run(amount, id)
  })
  // After the commit only (never inside the transaction): the products.cost cache follows the change.
  if (result === "ok" && key) await refreshProductionCosts([key])
  return result
}

/** «Удалить»: removes a shift entry; removing output needs it still in the warehouse (409 otherwise). */
export async function deleteActivityEntry(id: number): Promise<"ok" | "not_found"> {
  let key = ""
  const result = await withShiftEntry(id, async (tx, row) => {
    key = itemKey(row.item_kind, row.item_id)
    if (row.direction === "made") await requireEntryStock(tx, row, Number(row.amount) || 0, "Не возможно удалить. ")
    await tx.prepare("DELETE FROM production_movements WHERE id = ?").run(id)
  })
  if (result === "ok" && key) await refreshProductionCosts([key])
  return result
}

// ---------------------------------------------------------------------------
// The stage's own reconciliations of earlier versions (read only)
// ---------------------------------------------------------------------------
// «Сверить» now opens the warehouse's inventory (Склад → Инвентаризация), as the
// reference does, and the «Инвентаризация» sub-tab lists those inventories. The
// stage reconciliations recorded before (production_inventories, their differences
// booked as adjustment movements that stay in the stock) are kept and still listed.

/** expected = on hand at the end of the inventory day, defective units
 * included (what a physical count finds); defects = the brak inside it. */
export type InventoryLine = { key: string; name: string; unit: string; expected: number; defects?: number; actual: number; difference: number }
export type ProductionInventory = { id: number; stageId: number; warehouse: string; date: string; comment: string; userName: string; lines: InventoryLine[]; createdAt: string }

type InventoryRow = { id: number; stage_id: number; warehouse: string; date: string; comment: string; user_name: string; lines: string; created_at: string }

function toInventory(row: InventoryRow): ProductionInventory {
  let lines: InventoryLine[] = []
  try {
    const parsed = JSON.parse(row.lines) as unknown
    lines = Array.isArray(parsed) ? (parsed as InventoryLine[]) : []
  } catch {
    lines = []
  }
  return { id: row.id, stageId: row.stage_id, warehouse: row.warehouse, date: row.date, comment: row.comment, userName: row.user_name, lines, createdAt: row.created_at }
}

export async function listInventories(stageId: number, from: string, to: string): Promise<ProductionInventory[]> {
  const db = await getProductionDb()
  const rows = (await db
    .prepare("SELECT * FROM production_inventories WHERE stage_id = ? AND date >= ? AND date <= ? ORDER BY id DESC")
    .all(stageId, from, to)) as InventoryRow[]
  return rows.map(toInventory)
}
