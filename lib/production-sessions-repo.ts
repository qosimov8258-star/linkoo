import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { parseDocDate } from "@/lib/document-dates"
import { parseAnyDate } from "@/lib/finance/dates"
import { createShipmentTransfer, ensureTransfersSchema, isTransferError, syncTransferValues } from "@/lib/internal-transfers-repo"
import { findWarehouse, lockDocumentWarehouses } from "@/lib/internal-transfers-stock"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import { getProductionDb, itemKey, ProductionError, round, textKey } from "@/lib/production-schema"
import { WORKER_NOT_ON_STAGE } from "@/lib/production-stages-repo"
import { nowLocalMoment } from "@/lib/stock/moments"
import { ensureWorkShiftsSchema } from "@/lib/work-shifts-repo"

// Worker shift sessions of a production stage (Этапы производства → Активность → «Смены»), Linko's
// staff/personal_rotation: one employee of the stage's Персонал on one shift of the Смены directory, from «Начало
// смены» to «Конец смены» («Не закончилась» while open). Linko's workers open and close them in its mobile app; in
// Mezon a supervisor does it on the web (openSession / closeSession). The shift entries the worker books on the
// stage while the session is open belong to it (lib/production-activity-repo.ts). «Передать на склад»
// (handOverSession, Linko's POST …/personal_rotation/<id>/give/ {stock}) moves what the session made — its good and
// Брак output, never the raw it used — from the warehouse the entries were booked in to the chosen warehouse, as an
// «Отгрузка» (an internal transfer with source 'shipment', lib/internal-transfers-repo.ts createShipmentTransfer):
// the goods leave at once, the target takes them in Склад → План приемок и передач (Приемка; История Приемки undoes
// the acceptance). A handed-over session's entries can no longer be changed («Уже передан»). Moments are local
// (Asia/Tashkent) "YYYY-MM-DDTHH:mm:ss[.mmm]", comparable as text.

export const SESSION_OPEN_EXISTS = "У работника уже есть открытая смена"
export const SESSION_CLOSED = "Смена уже закрыта"
export const SESSION_END_BEFORE_START = "Конец смены не может быть раньше начала"
export const SESSION_END_BEFORE_ENTRY = "Конец смены не может быть раньше последней записи смены"
export const SESSION_START_BEFORE_PREVIOUS = "Начало смены не может быть раньше конца предыдущей смены"
export const SESSION_TIME_FUTURE = "Время не может быть позже текущего"
export const SESSION_NO_OUTPUT = "В этой смене не произведено продукции"
export const SESSION_MIXED_WAREHOUSES = "Продукция смены находится на разных складах"
export const SESSION_TRANSFERRED = "Уже передан на склад"
export const ENTRY_TRANSFERRED = "Уже передан"
export const WORKER_NOT_ON_SHIFT = "Работник не работает в этой смене на этапе"

/** Statuses of the «Отгрузка» in which the session counts as handed over (it can never be cancelled: Linko has no undo). */
const GIVEN_STATUSES = ["потвержден", "в пути", "принят"]

export type ProductionSession = {
  id: number
  stageId: number
  /** The Персонал row it was opened from (null once that row was removed). */
  staffId: number | null
  employeeId: number
  /** The employee's current name (the snapshot once the employee is gone). */
  workerName: string
  shiftId: number
  shiftName: string
  openedAt: string
  /** null: «Не закончилась». */
  closedAt: string | null
  openedBy: string
  closedBy: string
  isTransferred: boolean
  transferredAt: string
  transferredBy: string
  /** The «Отгрузка» of «Передать на склад»: 'в пути' until the target accepts it, then 'принят'. */
  transfer: { status: string; toWarehouse: string } | null
  /** Where the session's output is: the warehouse its entries were booked in (the stage's warehouse without any). */
  fromWarehouse: string
  /** Shift entries booked into the session. */
  entries: number
}

export type SessionFilters = { from: string; to: string; shifts?: string[]; worker?: string }
export type SessionList = { count: number; page: number; pageSize: number; results: ProductionSession[] }

type SessionRow = {
  id: number
  stage_id: number
  staff_id: number | null
  employee_id: number
  employee_name: string
  shift_id: number
  shift_name: string
  opened_at: string
  closed_at: string | null
  opened_by: string
  closed_by: string
  transfer_id: number | null
  transferred_at: string
  transferred_by: string
  live_worker: string | null
  live_shift: string | null
  transfer_status: string | null
  transfer_to: string | null
  entries: number | string | null
  output_warehouse: string | null
  stage_warehouse: string | null
}

const SESSION_SELECT = `
  SELECT s.id, s.stage_id, s.staff_id, s.employee_id, s.employee_name, s.shift_id, s.shift_name, s.opened_at, s.closed_at,
         s.opened_by, s.closed_by, s.transfer_id, s.transferred_at, s.transferred_by,
         NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '') AS live_worker,
         NULLIF(btrim(COALESCE(w.name, '')), '') AS live_shift,
         tr.status AS transfer_status, tr.to_warehouse AS transfer_to,
         (SELECT COUNT(*)::int FROM production_movements m WHERE m.session_id = s.id) AS entries,
         (SELECT MIN(m.warehouse) FROM production_movements m
           WHERE m.session_id = s.id AND m.party_id IS NULL AND m.direction = 'made' AND btrim(m.warehouse) <> '') AS output_warehouse,
         st.warehouse AS stage_warehouse
    FROM production_shift_sessions s
    LEFT JOIN employees e ON e.id = s.employee_id
    LEFT JOIN work_shifts w ON w.id = s.shift_id
    LEFT JOIN internal_transfers tr ON tr.id = s.transfer_id
    LEFT JOIN production_stages st ON st.id = s.stage_id`

function toSession(row: SessionRow): ProductionSession {
  const transferred = row.transfer_id !== null && row.transfer_id !== undefined && GIVEN_STATUSES.includes(String(row.transfer_status ?? ""))
  return {
    id: Number(row.id),
    stageId: Number(row.stage_id),
    staffId: row.staff_id === null || row.staff_id === undefined ? null : Number(row.staff_id),
    employeeId: Number(row.employee_id),
    workerName: (row.live_worker ?? row.employee_name ?? "").trim(),
    shiftId: Number(row.shift_id),
    shiftName: (row.live_shift ?? row.shift_name ?? "").trim(),
    openedAt: row.opened_at,
    closedAt: row.closed_at || null,
    openedBy: row.opened_by ?? "",
    closedBy: row.closed_by ?? "",
    isTransferred: transferred,
    transferredAt: transferred ? (row.transferred_at ?? "") : "",
    transferredBy: transferred ? (row.transferred_by ?? "") : "",
    transfer: transferred ? { status: String(row.transfer_status ?? ""), toWarehouse: String(row.transfer_to ?? "") } : null,
    fromWarehouse: String(row.output_warehouse ?? row.stage_warehouse ?? "").trim(),
    entries: Number(row.entries) || 0,
  }
}

/** Tables the session reads join (work_shifts is lazy), before any query or transaction. */
async function sessionSchemas(): Promise<PgDb> {
  const db = await getProductionDb()
  await ensureWorkShiftsSchema()
  await ensureTransfersSchema()
  return db
}

export async function getSession(id: number, db?: PgDb): Promise<ProductionSession | null> {
  const reader = db ?? (await sessionSchemas())
  const row = (await reader.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id)) as SessionRow | undefined
  return row ? toSession(row) : null
}

/** «Смены»: the stage's sessions that overlap the period (opened on or before its last day, and still open or closed
 * on or after its first day), newest first, filtered by shift and worker names (case and spacing ignored, as the
 * activity filter matches them) and paged. */
export async function listSessions(stageId: number, filters: SessionFilters, paging: { page: number; pageSize: number }): Promise<SessionList> {
  const db = await sessionSchemas()
  const rows = (await db
    .prepare(`${SESSION_SELECT} WHERE s.stage_id = ? AND left(s.opened_at, 10) <= ? AND (s.closed_at IS NULL OR left(s.closed_at, 10) >= ?) ORDER BY s.opened_at DESC, s.id DESC`)
    .all(stageId, filters.to, filters.from)) as SessionRow[]
  const shiftKeys = new Set((filters.shifts ?? []).map(textKey).filter(Boolean))
  const workerKey = textKey(filters.worker)
  const sessions = rows.map(toSession).filter((session) => (!shiftKeys.size || shiftKeys.has(textKey(session.shiftName))) && (!workerKey || textKey(session.workerName) === workerKey))
  const pageSize = Math.max(1, paging.pageSize)
  const pageCount = Math.max(1, Math.ceil(sessions.length / pageSize))
  const page = Math.min(Math.max(1, paging.page), pageCount)
  return { count: sessions.length, page, pageSize, results: sessions.slice((page - 1) * pageSize, page * pageSize) }
}

/** Shift and worker names the stage's sessions carry (the activity filter offers them). */
export async function sessionNames(db: PgDb, stageId: number): Promise<{ shifts: string[]; workers: string[] }> {
  const rows = (await db
    .prepare(
      `SELECT DISTINCT COALESCE(NULLIF(btrim(COALESCE(w.name, '')), ''), s.shift_name) AS shift,
              COALESCE(NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), ''), s.employee_name) AS worker
         FROM production_shift_sessions s LEFT JOIN employees e ON e.id = s.employee_id LEFT JOIN work_shifts w ON w.id = s.shift_id
        WHERE s.stage_id = ?`,
    )
    .all(stageId)) as Array<{ shift: string | null; worker: string | null }>
  return { shifts: rows.map((row) => String(row.shift ?? "").trim()).filter(Boolean), workers: rows.map((row) => String(row.worker ?? "").trim()).filter(Boolean) }
}

/** A typed moment ("YYYY-MM-DDTHH:mm[:ss]", or any date lib/document-dates.ts accepts; empty = now) → local
 * "YYYY-MM-DDTHH:mm:ss[.mmm]". A real date of a sane year, never after the current moment (400 otherwise). */
function momentInput(value: string | undefined | null, field: string): string {
  const now = nowLocalMoment()
  if (!value || !value.trim()) return now
  const parsed = parseDocDate(value)
  if (!parsed.ok) throw new ProductionError(400, parsed.error, { field })
  if (parsed.date > now.slice(0, 19)) throw new ProductionError(400, SESSION_TIME_FUTURE, { field })
  return parsed.date
}

/** Second-precision text of a stored moment (the fraction never decides an order between a typed and a stored one). */
const second = (value: string | null | undefined) => String(value ?? "").slice(0, 19)

const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"

export type SessionOpenInput = { stageId: number; employeeId: number; shiftId: number; openedAt?: string }

/** «Открыть смену»: the employee must be on the stage's Персонал for that shift (a roster row), active, and have no
 * open session anywhere (one at a time, 409 otherwise; parallel opens queue on the employee's lock and the partial
 * unique index backs it up). «Начало смены» defaults to now; it is never in the future and never before the end of
 * the employee's previous session. */
export async function openSession(input: SessionOpenInput, userName: string): Promise<ProductionSession | "stage_not_found"> {
  await sessionSchemas()
  const openedAt = momentInput(input.openedAt, "openedAt")
  try {
    const id = await withTransaction(async (tx) => {
      // One open session per employee: parallel opens of the same employee run one after another.
      await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(?)) AS ok").get(`linko-production-session:${input.employeeId}`)
      if (!(await tx.prepare("SELECT id FROM production_stages WHERE id = ? FOR KEY SHARE").get(input.stageId))) return "stage_not_found" as const
      const roster = (await tx
        .prepare("SELECT id, shift_id FROM production_staff WHERE stage_id = ? AND employee_id = ? ORDER BY id FOR KEY SHARE")
        .all(input.stageId, input.employeeId)) as Array<{ id: number; shift_id: number | null }>
      if (!roster.length) throw new ProductionError(400, WORKER_NOT_ON_STAGE, { field: "employeeId" })
      const staff = roster.find((row) => Number(row.shift_id) === input.shiftId)
      if (!staff) throw new ProductionError(400, WORKER_NOT_ON_SHIFT, { field: "shiftId" })
      const employee = (await tx.prepare("SELECT id, first_name, last_name, COALESCE(active, 1) AS active FROM employees WHERE id = ? FOR KEY SHARE").get(input.employeeId)) as
        | { id: number; first_name: string | null; last_name: string | null; active: number | boolean }
        | undefined
      if (!employee) throw new ProductionError(400, "Сотрудник не найден", { field: "employeeId" })
      if (!Number(employee.active)) throw new ProductionError(400, "Сотрудник неактивен", { field: "employeeId" })
      const shift = (await tx.prepare("SELECT id, name FROM work_shifts WHERE id = ? FOR KEY SHARE").get(input.shiftId)) as { id: number; name: string | null } | undefined
      if (!shift) throw new ProductionError(400, "Смена не найдена", { field: "shiftId" })
      const open = (await tx.prepare("SELECT id, stage_id FROM production_shift_sessions WHERE employee_id = ? AND closed_at IS NULL ORDER BY id LIMIT 1").get(input.employeeId)) as
        | { id: number; stage_id: number }
        | undefined
      if (open) throw new ProductionError(409, SESSION_OPEN_EXISTS, { openSession: { id: Number(open.id), stageId: Number(open.stage_id) } })
      const previous = (await tx.prepare("SELECT MAX(closed_at) AS closed FROM production_shift_sessions WHERE employee_id = ?").get(input.employeeId)) as { closed: string | null } | undefined
      if (previous?.closed && second(openedAt) < second(previous.closed)) throw new ProductionError(409, SESSION_START_BEFORE_PREVIOUS, { field: "openedAt", previousEnd: previous.closed })
      const name = `${String(employee.first_name ?? "").trim()} ${String(employee.last_name ?? "").trim()}`.trim()
      const row = (await tx
        .prepare(
          `INSERT INTO production_shift_sessions (stage_id, staff_id, employee_id, employee_name, shift_id, shift_name, opened_at, opened_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(input.stageId, staff.id, input.employeeId, name, input.shiftId, String(shift.name ?? "").trim(), openedAt, userName, nowLocalMoment())) as { id: number }
      return Number(row.id)
    })
    if (id === "stage_not_found") return id
    return (await getSession(id))!
  } catch (error) {
    if (isUniqueViolation(error)) throw new ProductionError(409, SESSION_OPEN_EXISTS)
    throw error
  }
}

/** «Закрыть смену»: «Конец смены» (default now) is not in the future, not before the start and not before the last
 * entry booked into the session. No stock effect. */
export async function closeSession(id: number, input: { closedAt?: string }, userName: string): Promise<ProductionSession | "not_found"> {
  await sessionSchemas()
  const closedAt = momentInput(input.closedAt, "closedAt")
  const done = await withTransaction(async (tx) => {
    const session = (await tx.prepare("SELECT id, opened_at, closed_at FROM production_shift_sessions WHERE id = ? FOR UPDATE").get(id)) as
      | { id: number; opened_at: string; closed_at: string | null }
      | undefined
    if (!session) return "not_found" as const
    if (session.closed_at) throw new ProductionError(409, SESSION_CLOSED)
    if (second(closedAt) < second(session.opened_at)) throw new ProductionError(400, SESSION_END_BEFORE_START, { field: "closedAt" })
    const latest = await latestEntryMoment(tx, id)
    if (latest && second(closedAt) < latest) throw new ProductionError(400, SESSION_END_BEFORE_ENTRY, { field: "closedAt", lastEntry: latest })
    await tx.prepare("UPDATE production_shift_sessions SET closed_at = ?, closed_by = ? WHERE id = ?").run(closedAt, userName, id)
    return "ok" as const
  })
  if (done === "not_found") return done
  return (await getSession(id))!
}

/** Local second of the latest booking of the session's entries ("" without any). */
async function latestEntryMoment(tx: PgDb, sessionId: number): Promise<string> {
  const rows = (await tx.prepare("SELECT created_at FROM production_movements WHERE session_id = ?").all(sessionId)) as Array<{ created_at: string | null }>
  let latest = ""
  for (const row of rows) {
    const moment = parseAnyDate(row.created_at) ?? ""
    if (moment > latest) latest = moment
  }
  return latest
}

// ---------------------------------------------------------------------------
// Shift entries ↔ sessions
// ---------------------------------------------------------------------------

/** The open session a shift entry belongs to (inside the entry's transaction): the session of `worker` (the stage
 * staff's canonical name) on this stage, for the entry's shift (any shift when the entry names none), opened on or
 * before the entry's day. The sessions are read FOR SHARE, so a hand-over or a close (FOR UPDATE) of that session
 * waits for the entry, then sees it. null: no such session (or two workers of that name: not attached). */
export async function sessionForEntry(tx: PgDb, stageId: number, worker: string, shiftId: number | null, date: string): Promise<{ id: number; shiftName: string } | null> {
  const key = textKey(worker)
  if (!key) return null
  const rows = (await tx
    .prepare(
      `SELECT s.id, s.shift_id, s.opened_at, s.employee_name, s.shift_name,
              NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '') AS live_worker,
              NULLIF(btrim(COALESCE(w.name, '')), '') AS live_shift
         FROM production_shift_sessions s LEFT JOIN employees e ON e.id = s.employee_id LEFT JOIN work_shifts w ON w.id = s.shift_id
        WHERE s.stage_id = ? AND s.closed_at IS NULL ORDER BY s.id FOR SHARE OF s`,
    )
    .all(stageId)) as Array<{ id: number; shift_id: number; opened_at: string; employee_name: string; shift_name: string; live_worker: string | null; live_shift: string | null }>
  const matches = rows.filter(
    (row) => textKey(row.live_worker ?? row.employee_name) === key && (shiftId === null || Number(row.shift_id) === shiftId) && String(row.opened_at).slice(0, 10) <= date,
  )
  if (matches.length !== 1) return null
  return { id: Number(matches[0].id), shiftName: String(matches[0].live_shift ?? matches[0].shift_name ?? "").trim() }
}

/** The entry's session as the entry's change sees it (inside its transaction, FOR SHARE): handed over = locked. */
export async function requireEntryEditable(tx: PgDb, sessionId: number | null | undefined): Promise<void> {
  if (sessionId === null || sessionId === undefined) return
  const row = (await tx
    .prepare("SELECT s.transfer_id, tr.status FROM production_shift_sessions s LEFT JOIN internal_transfers tr ON tr.id = s.transfer_id WHERE s.id = ? FOR SHARE OF s")
    .get(sessionId)) as { transfer_id: number | null; status: string | null } | undefined
  if (row && row.transfer_id !== null && row.transfer_id !== undefined && GIVEN_STATUSES.includes(String(row.status ?? ""))) throw new ProductionError(409, ENTRY_TRANSFERRED, { sessionId })
}

// ---------------------------------------------------------------------------
// «Передать на склад»
// ---------------------------------------------------------------------------

type OutputLine = { item_kind: string; item_id: number; item_name: string; unit: string; warehouse: string; is_defect: number; qty: number | string }

/** What the session made and still holds in the stock: its good and Брак output per item and warehouse (raw is
 * consumed, never handed over; lines the stock ledger leaves out are left out too). */
async function outputLines(db: PgDb, sessionId: number): Promise<OutputLine[]> {
  return (await db
    .prepare(
      `SELECT m.item_kind, m.item_id, MIN(m.item_name) AS item_name, MIN(m.unit) AS unit, m.warehouse, m.is_defect, SUM(m.amount) AS qty
         FROM production_movements m
        WHERE m.session_id = ? AND m.party_id IS NULL AND m.direction = 'made' AND COALESCE(m.in_stock, 1) = 1
        GROUP BY m.item_kind, m.item_id, m.warehouse, m.is_defect
       HAVING SUM(m.amount) > 0
        ORDER BY MIN(m.id)`,
    )
    .all(sessionId)) as OutputLine[]
}

/** The warehouses the lines sit in, one spelling each (case and spacing ignored, as the stock matches them). */
function warehousesOf(lines: OutputLine[]): string[] {
  const seen = new Map<string, string>()
  for (const line of lines) {
    const name = String(line.warehouse ?? "").trim()
    if (name && !seen.has(textKey(name))) seen.set(textKey(name), name)
  }
  return [...seen.values()]
}

/** The output's warehouse was renamed (or the output changed warehouse) between the unlocked read and its lock. */
class SessionOutputMoved extends Error {}

/**
 * «Передать на склад» (Linko's POST staff/personal_rotation/<id>/give/ {stock}): the session's output goes from the
 * warehouse its entries were booked in (not the stage's current one: a stage may have moved to another warehouse)
 * to `warehouseId`, as an «Отгрузка» given now. An open session is closed at that moment (Linko keeps the button
 * enabled on it). Lock order of every stock writer: the stock locks of both warehouses first (read without a lock,
 * locked, read again: a rename in between runs the transaction again), then the session row (FOR UPDATE: a second
 * «Да» waits and then gets 409 «Уже передан на склад»), then the transfer. Refused: an unknown or inactive target
 * (400), the target being the source (400), a session without output (409), output in more than one warehouse (409),
 * goods the source no longer holds on any day from now on (409 with the shortages, nothing written).
 */
export async function handOverSession(id: number, warehouseId: number, userName: string): Promise<ProductionSession | "not_found"> {
  const db = await sessionSchemas()
  // The cost ledger's install reads these tables on another connection: never from inside the transaction (C1).
  await ensureNetCostSchema()
  const target = (await db.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM warehouses WHERE id = ?").get(warehouseId)) as
    | { id: number; name: string; active: number | boolean }
    | undefined
  if (!target) throw new ProductionError(400, "Склад не найден", { field: "warehouseId" })
  if (!Number(target.active)) throw new ProductionError(400, "Склад неактивен", { field: "warehouseId" })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const done = await withTransaction(async (tx) => {
        const sources = warehousesOf(await outputLines(tx, id))
        const refs: Array<{ id: number | null; name: string }> = []
        for (const name of sources) refs.push({ id: (await findWarehouse(tx, name))?.id ?? null, name })
        const locked = await lockDocumentWarehouses(tx, [...refs, { id: Number(target.id), name: target.name }])
        const to = locked[locked.length - 1]
        if (!to) throw new ProductionError(400, "Склад не найден", { field: "warehouseId" })
        if (!to.active) throw new ProductionError(400, "Склад неактивен", { field: "warehouseId" })
        if (locked.slice(0, refs.length).some((entry) => !entry || entry.renamed)) throw new SessionOutputMoved()
        const session = (await tx.prepare("SELECT id, closed_at, transfer_id FROM production_shift_sessions WHERE id = ? FOR UPDATE").get(id)) as
          | { id: number; closed_at: string | null; transfer_id: number | null }
          | undefined
        if (!session) return "not_found" as const
        if (session.transfer_id !== null && session.transfer_id !== undefined) {
          const transfer = (await tx.prepare("SELECT status FROM internal_transfers WHERE id = ?").get(session.transfer_id)) as { status: string } | undefined
          if (transfer && GIVEN_STATUSES.includes(transfer.status)) throw new ProductionError(409, SESSION_TRANSFERRED)
        }
        // Read again under the locks: an entry changed or added before them is in, a later one waits for this.
        const lines = await outputLines(tx, id)
        const now = warehousesOf(lines)
        if (now.length !== sources.length || now.some((name) => !sources.some((other) => textKey(other) === textKey(name)))) throw new SessionOutputMoved()
        if (!lines.length) throw new ProductionError(409, SESSION_NO_OUTPUT)
        if (now.length > 1) throw new ProductionError(409, SESSION_MIXED_WAREHOUSES, { warehouses: now })
        const from = locked[0]?.name || now[0]
        if (textKey(from) === textKey(to.name)) throw new ProductionError(400, "Склад отправитель и склад получатель должны отличаться", { field: "warehouseId" })
        const moment = nowLocalMoment()
        // Linko's «Передать на склад» works on an open session too: handing it over ends it now.
        if (!session.closed_at) await tx.prepare("UPDATE production_shift_sessions SET closed_at = ?, closed_by = ? WHERE id = ?").run(moment, userName, id)
        const change = await createShipmentTransfer(
          tx,
          {
            sessionId: id,
            fromWarehouse: from,
            toWarehouse: to.name,
            items: lines.map((line) => ({ key: itemKey(line.item_kind, Number(line.item_id)), product: line.item_name, quantity: round(Number(line.qty), 6), defect: Number(line.is_defect) === 1 })),
          },
          userName,
        )
        if (isTransferError(change)) {
          throw new ProductionError(change.status, change.error, { ...(change.field ? { field: change.field } : {}), ...(change.shortages ? { shortages: change.shortages } : {}) })
        }
        await tx.prepare("UPDATE production_shift_sessions SET transfer_id = ?, transferred_at = ?, transferred_by = ? WHERE id = ?").run(change.id, moment, userName, id)
        return "ok" as const
      })
      if (done === "not_found") return done
      // The goods left: the cost ledger values the «Отгрузка» (createShipmentTransfer skips it inside a transaction).
      await syncTransferValues()
      return (await getSession(id))!
    } catch (error) {
      if (!(error instanceof SessionOutputMoved)) throw error
    }
  }
  throw new ProductionError(503, "Не удалось выполнить запрос")
}

/** The «Отгрузка» of a session (null: not handed over). */
export async function sessionTransferId(sessionId: number): Promise<number | null> {
  const db = await sessionSchemas()
  const row = (await db.prepare("SELECT id FROM internal_transfers WHERE source = 'shipment' AND source_id = ?").get(sessionId)) as { id: number } | undefined
  return row ? Number(row.id) : null
}
