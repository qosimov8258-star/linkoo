import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"

// The shop drawer (ClientDrawer / ClientDetail, components/clients/clients-view.tsx): what Linko's market card shows
// beyond the client row itself.
//   - linko_market_cards: Linko's market/market/<id>/ detail fields the client table has no column for (price list,
//     «Статус ИНН», «Создал», «Класс клиента» per organization, the last payment day);
//   - linko_market_plans: market/market/<id>/detail_plans/ (the ЗАДАЧИ timeline), in Linko's order;
//   - linko_market_logs: market/market_logs/?market=<id> (КЛИЕНТ → ЛОГИ), in Linko's order.
// They are filled by scripts/linko-sync/import-shop-drawer.mjs. A shop copied from Linko shows Linko's rows and, after
// them, what was done here since the copy; a shop without a copy shows what the app's own documents say.

export const SHOP_DRAWER_DDL = [
  `CREATE TABLE IF NOT EXISTS linko_market_cards (
    client_id INTEGER PRIMARY KEY,
    price_list_id INTEGER,
    price_list_name TEXT NOT NULL DEFAULT '',
    inn_is_correct BOOLEAN,
    created_by TEXT NOT NULL DEFAULT '',
    market_class TEXT NOT NULL DEFAULT '',
    class_divisions TEXT NOT NULL DEFAULT '[]',
    last_payment_date TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS linko_market_plans (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    employee_id INTEGER,
    employee_name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    done_at TEXT,
    order_id INTEGER,
    return_id INTEGER,
    transaction_id INTEGER,
    unscheduled BOOLEAN NOT NULL DEFAULT false
  )`,
  "CREATE INDEX IF NOT EXISTS linko_market_plans_client ON linko_market_plans (client_id, position)",
  `CREATE TABLE IF NOT EXISTS linko_market_logs (
    client_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    action TEXT NOT NULL DEFAULT '',
    status TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    total_price DOUBLE PRECISION,
    currency TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (client_id, type, id)
  )`,
  "CREATE INDEX IF NOT EXISTS linko_market_logs_client ON linko_market_logs (client_id, position)",
  // ФИНАНСОВЫЕ НАСТРОЙКИ (without_bonus, promotions, performance_indicators), the order of the market options in
  // ДЕТАЛИ, «Комментарий отказа» (last_reject_comment) and each log's place in Linko's list of its own type (the filter
  // pills ask Linko for one type, which comes back in another order than the full list).
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS without_bonus BOOLEAN",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS promotions TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS kpis TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS option_names TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS last_reject_comment TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE linko_market_logs ADD COLUMN IF NOT EXISTS type_position INTEGER",
]

declare global {
  var __linkoShopDrawerSchemaV2: Promise<void> | undefined
}

export function ensureShopDrawerSchema(): Promise<void> {
  globalThis.__linkoShopDrawerSchemaV2 ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:shop_drawer'))")
      for (const statement of SHOP_DRAWER_DDL) await tx.exec(statement)
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoShopDrawerSchemaV2 = undefined
    throw error
  })
  return globalThis.__linkoShopDrawerSchemaV2
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------------

const MONTHS_NOMINATIVE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

/** Tashkent wall-clock parts of a stored moment: "YYYY-MM-DD HH:MM:SS" text columns are UTC (datetime('now')), a
 * timestamptz comes as a Date. */
function tashkentParts(value: string | Date | null | undefined): { y: number; m: number; d: number; h: number; mi: number } | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${String(value).replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return null
  const local = new Date(date.getTime() + 5 * 3600_000)
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), h: local.getUTCHours(), mi: local.getUTCMinutes() }
}

/** "YYYY-MM-DDTHH:MM:SS" in Tashkent time (the form Linko's own moments are stored in). */
function tashkentIso(value: string | Date | null | undefined): string | null {
  const p = tashkentParts(value)
  if (!p) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00`
}

/** An amount as Linko's plan texts write it: plain spaces between thousands, a dot before at most two decimals, no
 * trailing zeros ("Оплатили 4 347.83 USD", "Оплатили 500 000 SUM"). */
function planAmount(value: number): string {
  const [whole, fraction] = (Math.round((Number(value) || 0) * 100) / 100).toFixed(2).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  const decimals = fraction.replace(/0+$/, "")
  return decimals ? `${grouped}.${decimals}` : grouped
}

/** "9:48": Linko's time in its plan texts (the hour not padded, the minutes padded). */
const planTime = (p: { h: number; mi: number }) => `${p.h}:${String(p.mi).padStart(2, "0")}`

/** The moment the Linko data was copied here (the latest linko_history mark); null on a database that never was. */
async function copyMoment(db: PgDb): Promise<string | null> {
  const exists = (await db.prepare("SELECT to_regclass('public.linko_history') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) return null
  const row = (await db.prepare("SELECT max(until) AS until FROM linko_history").get()) as { until: string | null } | undefined
  return row?.until ?? null
}

async function tableExists(db: PgDb, name: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(?) IS NOT NULL AS ok").get(`public.${name}`)) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

// ---------------------------------------------------------------------------------------------------------------------
// The card's extra fields (ДЕТАЛИ, «Последняя дата платежа»)
// ---------------------------------------------------------------------------------------------------------------------

export type ShopCard = {
  /** The shop was copied from Linko (its ЗАДАЧИ / ЛОГИ come from the copy). */
  copied: boolean
  priceList: string
  /** Linko's inn_is_correct; null when the shop was not copied (the app has no INN check of its own). */
  innIsCorrect: boolean | null
  createdBy: string
  marketClass: string
  classDivisions: Array<{ className: string; division: string }>
  /** Linko's last_payment_date (YYYY-MM-DD; "2020-01-01" is what Linko keeps for a shop that never paid). */
  lastPaymentDate: string
  /** The day of the latest payment made here after the Linko copy (YYYY-MM-DD, Tashkent), "" without one. */
  ownLastPaymentDate: string
  /** «Финансовый счет»: the financial account the shop belongs to ("" when it has none). */
  account: string
  /** ФИНАНСОВЫЕ НАСТРОЙКИ: «Без автоматических бонусов» (Linko's without_bonus), its marketing promotions and KPIs. */
  withoutBonus: boolean
  promotions: string[]
  kpis: string[]
  /** Linko's market option names in its order (ДЕТАЛИ lists the client attributes in it). */
  optionNames: string[]
  /** Linko's last_reject_comment of a copied shop ("" when it has none). */
  lastRejectComment: string
}

export async function getShopCard(clientId: number): Promise<ShopCard> {
  await ensureShopDrawerSchema()
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM linko_market_cards WHERE client_id = ?").get(clientId)) as
    | {
        price_list_id: number | null
        price_list_name: string
        inn_is_correct: boolean | null
        created_by: string
        market_class: string
        class_divisions: string
        last_payment_date: string
        without_bonus: boolean | null
        promotions: string | null
        kpis: string | null
        option_names: string | null
        last_reject_comment: string | null
      }
    | undefined
  let priceList = row?.price_list_name ?? ""
  if (!priceList) {
    // A shop with Linko's 1C attribute PRICE_LIST_ID (client attributes) names its price list there.
    const client = (await db.prepare("SELECT attributes FROM clients WHERE id = ?").get(clientId)) as { attributes: string | null } | undefined
    let listId = 0
    try {
      listId = Number((JSON.parse(client?.attributes || "{}") as Record<string, unknown>).PRICE_LIST_ID) || 0
    } catch {
      listId = 0
    }
    if (listId && (await tableExists(db, "price_lists"))) {
      const list = (await db.prepare("SELECT name FROM price_lists WHERE id = ?").get(listId)) as { name: string } | undefined
      priceList = list?.name ?? ""
    }
  }
  let classDivisions: ShopCard["classDivisions"] = []
  try {
    const parsed = JSON.parse(row?.class_divisions || "[]") as unknown
    if (Array.isArray(parsed)) classDivisions = parsed.map((item) => ({ className: String((item as { className?: unknown }).className ?? ""), division: String((item as { division?: unknown }).division ?? "") }))
  } catch {
    classDivisions = []
  }
  let account = ""
  if ((await tableExists(db, "financial_accounts")) && (await tableExists(db, "financial_account_markets"))) {
    const found = (await db
      .prepare(
        `SELECT f.name FROM financial_accounts f
          WHERE f.id = COALESCE((SELECT m.financial_account_id FROM financial_account_markets m WHERE m.client_id = ?),
                                (SELECT c.financial_account_id FROM clients c WHERE c.id = ?))`,
      )
      .get(clientId, clientId)) as { name: string } | undefined
    account = found?.name ?? ""
  }
  const names = (raw: string | null | undefined): string[] => {
    try {
      const parsed = JSON.parse(raw || "[]") as unknown
      return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "")).filter(Boolean) : []
    } catch {
      return []
    }
  }
  // Payments made here after the copy move «Последняя дата платежа» on; the copied ledger's older payments do not (Linko's
  // own last_payment_date is kept for them, as Linko shows it).
  const since = await copyMoment(db)
  const own = (await db
    .prepare(
      `SELECT max(left(NULLIF(payment_date, ''), 10)) AS day
         FROM customer_payments
        WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0 AND (?::text IS NULL OR created_at > ?::text)`,
    )
    .get(clientId, since, since)
    .catch(() => null)) as { day: string | null } | null
  return {
    copied: Boolean(row),
    account,
    priceList,
    innIsCorrect: row ? row.inn_is_correct : null,
    createdBy: row?.created_by ?? "",
    marketClass: row?.market_class ?? "",
    classDivisions,
    lastPaymentDate: row?.last_payment_date ?? "",
    ownLastPaymentDate: own?.day ?? "",
    withoutBonus: Boolean(row?.without_bonus),
    promotions: names(row?.promotions),
    kpis: names(row?.kpis),
    optionNames: names(row?.option_names),
    lastRejectComment: row?.last_reject_comment ?? "",
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// ЗАДАЧИ: the timeline
// ---------------------------------------------------------------------------------------------------------------------

export type ShopPlan = {
  key: string
  user: string
  text: string
  /** pending | done | undone */
  status: string
  type: string
  /** Tashkent "YYYY-MM-DDTHH:MM:SS" of a done plan. */
  doneAt: string | null
  orderId: number | null
}

export type ShopPlanPage = { count: number; results: ShopPlan[] }

const visitText = (planned: boolean, at: string | Date) => {
  const p = tashkentParts(at)
  if (!p) return planned ? "Посетили" : "Внеплановый визит"
  // Linko's own text, with its trailing space: "Внеплановый визит 27 Январь в 21:52 ", "… 22 Июль в 9:48 ".
  return `${planned ? "Посетили" : "Внеплановый визит"} ${p.d} ${MONTHS_NOMINATIVE[p.m - 1]} в ${planTime(p)} `
}

/** The app's own events of a shop, in Linko's plan wording, newest first; `since` keeps only those made after the
 * Linko copy (for a copied shop, whose earlier history is Linko's). */
async function appPlans(db: PgDb, clientId: number, since: string | null): Promise<ShopPlan[]> {
  const rows: Array<ShopPlan & { sort: string }> = []
  const after = (value: string | Date | null | undefined) => {
    if (!since) return true
    const iso = value instanceof Date ? value.toISOString() : String(value ?? "")
    return Boolean(iso) && iso.replace("T", " ") > since.replace("T", " ")
  }
  // «Создать задачу»: the tasks (Задачи) of the shop, one entry per plan day.
  if (await tableExists(db, "task_plans")) {
    const tasks = (await db
      .prepare(
        `SELECT p.id, p.plan_date, p.status, p.done_at, t.description, t.responsible, t.created_at
           FROM task_plans p JOIN tasks t ON t.id = p.task_id
          WHERE t.client_id = ?
          ORDER BY p.plan_date DESC, p.id DESC`,
      )
      .all(clientId)) as Array<{ id: number; plan_date: string; status: string; done_at: string; description: string; responsible: string; created_at: string }>
    for (const task of tasks) {
      if (!after(task.created_at)) continue
      const [y, m, d] = String(task.plan_date).split("-").map(Number)
      const done = task.status === "done" || task.status === "finished"
      rows.push({
        key: `task:${task.id}`,
        user: task.responsible ?? "",
        // Linko's wording of a task plan: "<comment> | надо выполнить 4 Декабрь 2026", once done "<comment> | выполнено".
        text: done ? `${task.description ?? ""} | выполнено` : `${task.description ?? ""} | надо выполнить ${d} ${MONTHS_NOMINATIVE[(m || 1) - 1]} ${y}`,
        status: done ? "done" : task.status === "undone" ? "undone" : "pending",
        type: "custom",
        doneAt: done ? tashkentIso(task.done_at) : null,
        orderId: null,
        sort: `${task.plan_date}T23:59:59`,
      })
    }
  }
  const orders = (await db
    .prepare("SELECT id, status, created_at, shipped_at, agent, created_by, delivery_man FROM orders WHERE client_id = ? ORDER BY created_at DESC, id DESC")
    .all(clientId)) as Array<{ id: number; status: string; created_at: string; shipped_at: string | null; agent: string; created_by: string; delivery_man: string }>
  for (const order of orders) {
    if (!after(order.created_at)) continue
    const created = tashkentIso(order.created_at)
    const user = (order.created_by || order.agent || "").trim()
    rows.push({ key: `order:${order.id}`, user, text: `Оформили заказ №${order.id}`, status: "done", type: "order", doneAt: created, orderId: order.id, sort: created ?? "" })
    if (order.status === "Отменен") rows.push({ key: `order-cancel:${order.id}`, user, text: `Отменен заказ ${order.id}`, status: "undone", type: "order", doneAt: null, orderId: order.id, sort: created ?? "" })
    // Linko's pending «Следует доставить заказ №N» while the order is on its way.
    if (order.status === "В пути") rows.push({ key: `delivery-pending:${order.id}`, user: (order.delivery_man || user).trim(), text: `Следует доставить заказ №${order.id}`, status: "pending", type: "delivery", doneAt: null, orderId: order.id, sort: created ?? "" })
    if (order.status === "Доставлено") {
      const at = tashkentParts(order.shipped_at || order.created_at)
      const done = tashkentIso(order.shipped_at || order.created_at)
      rows.push({
        key: `delivery:${order.id}`,
        user: (order.delivery_man || user).trim(),
        text: `Доставили заказ №${order.id} в ${at ? planTime(at) : ""}`,
        status: "done",
        type: "delivery",
        doneAt: done,
        orderId: order.id,
        sort: done ?? "",
      })
    }
  }
  const returns = (await db
    .prepare("SELECT id, status, created_at, created_by FROM client_returns WHERE client_id = ? ORDER BY created_at DESC, id DESC")
    .all(clientId)) as Array<{ id: number; status: string; created_at: string; created_by: string }>
  for (const item of returns) {
    if (!after(item.created_at)) continue
    const created = tashkentIso(item.created_at)
    rows.push({ key: `return:${item.id}`, user: item.created_by ?? "", text: `Оформили возврат №${item.id}`, status: "done", type: "order_return", doneAt: created, orderId: null, sort: created ?? "" })
    if (item.status === "cancelled") rows.push({ key: `return-cancel:${item.id}`, user: item.created_by ?? "", text: `Отменен возврат ${item.id}`, status: "undone", type: "order_return", doneAt: null, orderId: null, sort: created ?? "" })
  }
  // «Добавить оплату»: Linko's «Оплатили 500 000 SUM»; a deleted payment adds «Отменен оплата 65000 SUM (№ 1218)».
  const payments = (await db
    .prepare("SELECT id, created_at, created_by, amount, currency, payment_date, COALESCE(is_deleted, 0) AS is_deleted FROM customer_payments WHERE client_id = ? ORDER BY created_at DESC, id DESC")
    .all(clientId)) as Array<{ id: number; created_at: string; created_by: string; amount: number | null; currency: string | null; payment_date: string | null; is_deleted: number }>
  for (const payment of payments) {
    if (!after(payment.created_at)) continue
    const done = /^\d{4}-\d{2}-\d{2}T/.test(payment.payment_date ?? "") ? String(payment.payment_date).slice(0, 19) : tashkentIso(payment.created_at)
    const currency = payment.currency || "SUM"
    rows.push({ key: `payment:${payment.id}`, user: payment.created_by ?? "", text: `Оплатили ${planAmount(Number(payment.amount))} ${currency}`, status: "done", type: "payment", doneAt: done, orderId: null, sort: done ?? "" })
    if (Number(payment.is_deleted)) {
      rows.push({ key: `payment-cancel:${payment.id}`, user: payment.created_by ?? "", text: `Отменен оплата ${Number(payment.amount) || 0} ${currency} (№ ${payment.id})`, status: "undone", type: "payment", doneAt: null, orderId: null, sort: done ?? "" })
    }
  }
  const employeeName = "btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))"
  // «Отказ»: Linko's «Отказ: Цены дорогие» (the refusal type, or the agent's own reason).
  if (await tableExists(db, "field_refusals")) {
    const refusals = (await db
      .prepare(`SELECT r.id, r.happened_at, r.reason, r.comment, ${employeeName} AS employee FROM field_refusals r LEFT JOIN employees e ON e.id = r.employee_id WHERE r.client_id = ? ORDER BY r.happened_at DESC, r.id DESC`)
      .all(clientId)) as Array<{ id: number; happened_at: Date | string; reason: string | null; comment: string | null; employee: string | null }>
    for (const refusal of refusals) {
      if (!after(refusal.happened_at)) continue
      const done = tashkentIso(refusal.happened_at)
      rows.push({ key: `rejection:${refusal.id}`, user: refusal.employee ?? "", text: `Отказ: ${(refusal.reason || refusal.comment || "").trim()}`, status: "done", type: "rejection", doneAt: done, orderId: null, sort: done ?? "" })
    }
  }
  // A photo report: Linko's «Фото отчет № 11».
  if (await tableExists(db, "field_photo_reports")) {
    const reports = (await db
      .prepare(`SELECT r.id, r.happened_at, ${employeeName} AS employee FROM field_photo_reports r LEFT JOIN employees e ON e.id = r.employee_id WHERE r.client_id = ? ORDER BY r.happened_at DESC, r.id DESC`)
      .all(clientId)) as Array<{ id: number; happened_at: Date | string; employee: string | null }>
    for (const report of reports) {
      if (!after(report.happened_at)) continue
      const done = tashkentIso(report.happened_at)
      rows.push({ key: `report:${report.id}`, user: report.employee ?? "", text: `Фото отчет № ${report.id}`, status: "done", type: "march_report", doneAt: done, orderId: null, sort: done ?? "" })
    }
  }
  if (await tableExists(db, "field_visits")) {
    const visits = (await db
      .prepare(
        `SELECT v.id, v.started_at, v.finished_at, v.planned, v.result,
                btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee
           FROM field_visits v LEFT JOIN employees e ON e.id = v.employee_id
          WHERE v.client_id = ? AND v.order_id IS NULL
          ORDER BY v.started_at DESC, v.id DESC`,
      )
      .all(clientId)) as Array<{ id: number; started_at: Date | string; finished_at: Date | string | null; planned: boolean | null; result: string | null; employee: string | null }>
    for (const visit of visits) {
      if (!after(visit.started_at)) continue
      const done = tashkentIso(visit.started_at)
      // A finished visit: Linko's «Обслуживание заняло 2 минут 55 сек.» (whole minutes, however many) at its end.
      const finished = visit.finished_at ? tashkentIso(visit.finished_at) : null
      const seconds = visit.finished_at ? Math.max(0, Math.round((new Date(visit.finished_at).getTime() - new Date(visit.started_at).getTime()) / 1000)) : NaN
      if (finished && Number.isFinite(seconds)) {
        const minutes = Math.floor(seconds / 60)
        rows.push({
          key: `service:${visit.id}`,
          user: visit.employee ?? "",
          text: minutes ? `Обслуживание заняло ${minutes} минут ${seconds % 60} сек.` : `Обслуживание заняло ${seconds} сек.`,
          status: "done",
          type: "service_time",
          doneAt: finished,
          orderId: null,
          sort: finished,
        })
      }
      rows.push({
        key: `visit:${visit.id}`,
        user: visit.employee ?? "",
        text: visitText(Boolean(visit.planned), visit.started_at),
        status: visit.result === "open" ? "pending" : "done",
        type: visit.planned ? "visit" : "no_plan_visit",
        doneAt: done,
        orderId: null,
        sort: done ?? "",
      })
    }
  }
  return rows.sort((a, b) => b.sort.localeCompare(a.sort)).map((row) => ({ key: row.key, user: row.user, text: row.text, status: row.status, type: row.type, doneAt: row.doneAt, orderId: row.orderId }))
}

/** One page of the ЗАДАЧИ timeline (Linko's detail_plans, 25 a page). */
export async function listShopPlans(clientId: number, page: number, pageSize: number): Promise<ShopPlanPage> {
  await ensureShopDrawerSchema()
  const db = getDb()
  const card = (await db.prepare("SELECT fetched_at FROM linko_market_cards WHERE client_id = ?").get(clientId)) as { fetched_at: string } | undefined
  // Only what was done here after the Linko copy: earlier events of a shop are Linko's (copied or not).
  const own = await appPlans(db, clientId, (await copyMoment(db)) ?? card?.fetched_at ?? null)
  const copied = card
    ? ((await db
        .prepare("SELECT id, employee_name, text, status, type, done_at, order_id FROM linko_market_plans WHERE client_id = ? ORDER BY position, id DESC")
        .all(clientId)) as Array<{ id: number; employee_name: string; text: string; status: string; type: string; done_at: string | null; order_id: number | null }>)
    : []
  const all: ShopPlan[] = [
    ...own,
    ...copied.map((row) => ({
      key: `linko:${row.id}`,
      user: row.employee_name,
      text: row.text,
      status: row.status,
      type: row.type,
      doneAt: row.done_at,
      orderId: row.order_id === null ? null : Number(row.order_id),
    })),
  ]
  const start = (page - 1) * pageSize
  return { count: all.length, results: all.slice(start, start + pageSize) }
}

// ---------------------------------------------------------------------------------------------------------------------
// КЛИЕНТ → ЛОГИ
// ---------------------------------------------------------------------------------------------------------------------

export const SHOP_LOG_TYPES = ["order", "order_return", "client_transaction", "market"] as const
export type ShopLogType = (typeof SHOP_LOG_TYPES)[number]

export type ShopLog = {
  key: string
  type: ShopLogType
  action: string
  createdBy: string
  /** Tashkent "YYYY-MM-DDTHH:MM:SS". */
  createdAt: string
  totalPrice: number | null
  currency: string
  comment: string
}

export type ShopLogPage = { count: number; results: ShopLog[] }

/** The app's own documents of a shop as log entries, newest first (after the Linko copy for a copied shop). */
async function appLogs(db: PgDb, clientId: number, since: string | null): Promise<ShopLog[]> {
  const logs: ShopLog[] = []
  const after = (value: string | null | undefined) => !since || (Boolean(value) && String(value).replace("T", " ") > since.replace("T", " "))
  const client = (await db.prepare("SELECT created_at, created_by FROM clients WHERE id = ?").get(clientId)) as { created_at: string; created_by: string } | undefined
  if (client && after(client.created_at)) {
    logs.push({ key: `market:${clientId}`, type: "market", action: "market_created", createdBy: client.created_by ?? "", createdAt: tashkentIso(client.created_at) ?? "", totalPrice: 0, currency: "", comment: "" })
  }
  const orders = (await db
    .prepare("SELECT id, status, created_at, created_by, agent, total_price, currency, comment FROM orders WHERE client_id = ?")
    .all(clientId)) as Array<{ id: number; status: string; created_at: string; created_by: string; agent: string; total_price: number | null; currency: string | null; comment: string | null }>
  for (const order of orders) {
    if (!after(order.created_at)) continue
    logs.push({
      key: `order:${order.id}`,
      type: "order",
      action: order.status === "Отменен" ? "canceled" : "created",
      createdBy: (order.created_by || order.agent || "").trim(),
      createdAt: tashkentIso(order.created_at) ?? "",
      totalPrice: order.total_price === null ? null : Number(order.total_price),
      currency: order.currency || "SUM",
      comment: "",
    })
  }
  const returns = (await db
    .prepare("SELECT id, status, created_at, created_by, amount, currency FROM client_returns WHERE client_id = ?")
    .all(clientId)) as Array<{ id: number; status: string; created_at: string; created_by: string; amount: number | null; currency: string | null }>
  for (const item of returns) {
    if (!after(item.created_at)) continue
    logs.push({
      key: `return:${item.id}`,
      type: "order_return",
      action: item.status === "accepted" ? "accepted_to_stock" : item.status === "cancelled" ? "canceled" : "created",
      createdBy: item.created_by ?? "",
      createdAt: tashkentIso(item.created_at) ?? "",
      totalPrice: item.amount === null ? null : Number(item.amount),
      currency: item.currency || "SUM",
      comment: "",
    })
  }
  const payments = (await db
    .prepare("SELECT id, created_at, created_by, amount, currency, comment, COALESCE(is_deleted, 0) AS is_deleted FROM customer_payments WHERE client_id = ?")
    .all(clientId)) as Array<{ id: number; created_at: string; created_by: string; amount: number | null; currency: string | null; comment: string | null; is_deleted: number }>
  for (const payment of payments) {
    if (!after(payment.created_at)) continue
    logs.push({
      key: `payment:${payment.id}`,
      type: "client_transaction",
      action: Number(payment.is_deleted) ? "deleted" : "created",
      createdBy: payment.created_by ?? "",
      createdAt: tashkentIso(payment.created_at) ?? "",
      totalPrice: payment.amount === null ? null : Number(payment.amount),
      currency: payment.currency || "SUM",
      comment: payment.comment ?? "",
    })
  }
  return logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** One page of КЛИЕНТ → ЛОГИ, optionally one type (Linko's filter pills: Заказ / Возврат / Финансы / Клиент). */
export async function listShopLogs(clientId: number, type: ShopLogType | null, page: number, pageSize: number): Promise<ShopLogPage> {
  await ensureShopDrawerSchema()
  const db = getDb()
  const card = (await db.prepare("SELECT fetched_at FROM linko_market_cards WHERE client_id = ?").get(clientId)) as { fetched_at: string } | undefined
  // Only what was done here after the Linko copy: a shop's earlier history is Linko's (copied or not), never made up.
  const own = await appLogs(db, clientId, (await copyMoment(db)) ?? card?.fetched_at ?? null)
  // One type comes in Linko's order of that type's own list (type_position), the full list in its order (position).
  const copied = card
    ? ((await db
        .prepare(
          `SELECT type, id, action, created_at, created_by, total_price, currency, comment FROM linko_market_logs
            WHERE client_id = ? AND (?::text IS NULL OR type = ?)
            ORDER BY ${type ? "COALESCE(type_position, position), position" : "position"}`,
        )
        .all(clientId, type, type)) as Array<{ type: ShopLogType; id: number; action: string; created_at: string; created_by: string; total_price: number | null; currency: string; comment: string }>)
    : []
  const all: ShopLog[] = [
    ...own,
    ...copied.map((row) => ({
      key: `linko:${row.type}:${row.id}`,
      type: row.type,
      action: row.action,
      createdBy: row.created_by,
      createdAt: row.created_at,
      totalPrice: row.total_price === null ? null : Number(row.total_price),
      currency: row.currency,
      comment: row.comment,
    })),
  ].filter((log) => !type || log.type === type)
  const start = (page - 1) * pageSize
  return { count: all.length, results: all.slice(start, start + pageSize) }
}

// ---------------------------------------------------------------------------------------------------------------------
// КЛИЕНТ → ДОГОВОРЫ
// ---------------------------------------------------------------------------------------------------------------------

export type ShopContract = { id: number; number: string; createdAt: string; organization: string }

/** The shop's contracts (sales/contract/?market=<id>), newest first like Linko (one day's in id order). */
export async function listShopContracts(clientId: number, page: number, pageSize: number): Promise<{ count: number; results: ShopContract[] }> {
  const db = getDb()
  if (!(await tableExists(db, "contracts")) || !(await tableExists(db, "contract_clients"))) return { count: 0, results: [] }
  const rows = (await db
    .prepare(
      `SELECT c.id, c.contract_number, c.contract_prefix, c.contract_suffix, c.created_at, c.contract_date, c.organization
         FROM contracts c
        WHERE c.id IN (SELECT contract_id FROM contract_clients WHERE client_id = ?)
        ORDER BY COALESCE(NULLIF(c.contract_date, ''), replace(c.created_at, ' ', 'T')) DESC, c.id`,
    )
    .all(clientId)) as Array<{ id: number; contract_number: number | null; contract_prefix: string; contract_suffix: string; created_at: string; contract_date: string; organization: string }>
  const start = (page - 1) * pageSize
  return {
    count: rows.length,
    results: rows.slice(start, start + pageSize).map((row) => ({
      id: Number(row.id),
      number: `${row.contract_prefix ?? ""}${row.contract_number ?? ""}${row.contract_suffix ?? ""}`,
      // Linko's created_date (Tashkent time) when the contract came from Linko, else the row's own UTC moment.
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(row.contract_date ?? "") ? row.contract_date : (tashkentIso(row.created_at) ?? ""),
      organization: row.organization ?? "",
    })),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// «Создать задачу»: the shop's responsible people (Linko's get_responsible_users)
// ---------------------------------------------------------------------------------------------------------------------

export type ShopResponsible = { employeeId: number; name: string; role: string }

/** The shop's responsible agent, delivery man and collector (the client columns name them by name). */
export async function listShopResponsibles(clientId: number): Promise<ShopResponsible[]> {
  const db = getDb()
  const client = (await db.prepare("SELECT agent, deliverer, collector FROM clients WHERE id = ?").get(clientId)) as
    | { agent: string; deliverer: string; collector: string }
    | undefined
  if (!client) return []
  // Linko lists them whether or not they still work (an inactive one is refused when the task is saved). Of two
  // employees with one name the active one wins; two active ones stay unresolved.
  const employees = (await db
    .prepare("SELECT id, btrim(btrim(coalesce(first_name, '')) || ' ' || btrim(coalesce(last_name, ''))) AS name, COALESCE(active, 1) AS active FROM employees ORDER BY COALESCE(active, 1) DESC, id")
    .all()) as Array<{ id: number; name: string; active: number }>
  const key = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase()
  const byName = new Map<string, { id: number | null; active: boolean }>()
  for (const employee of employees) {
    const k = key(employee.name)
    if (!k) continue
    const active = Number(employee.active) === 1
    const known = byName.get(k)
    if (!known) byName.set(k, { id: Number(employee.id), active })
    else if (known.active && active) byName.set(k, { id: null, active })
  }
  const result: ShopResponsible[] = []
  for (const [name, role] of [
    [client.agent, "Агент"],
    [client.deliverer, "Доставщик"],
    [client.collector, "Инкассатор"],
  ] as const) {
    const id = byName.get(key(name ?? ""))?.id
    if (!id || result.some((item) => item.employeeId === id && item.role === role)) continue
    result.push({ employeeId: id, name: (name ?? "").trim(), role })
  }
  return result
}

/** page / pageSize of the drawer's lists (Linko's pager: 25 a page; at most 1000). */
export function pageParams(search: URLSearchParams): { page: number; pageSize: number } {
  const page = Number(search.get("page"))
  const pageSize = Number(search.get("pageSize"))
  return {
    page: Number.isInteger(page) && page > 0 && page < 100_000 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 1000) : 25,
  }
}
