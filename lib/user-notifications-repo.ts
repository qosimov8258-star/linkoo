import "server-only"

import { getDb, isolated, outsideTransaction, type PgDb } from "@/lib/db"
import { keySql } from "@/lib/platform-refs"
import { MAX_DB_ID, strictId } from "@/lib/strict-number"
import { LEGACY_NOTIFICATION_SEED } from "@/lib/user-notifications-legacy-seed"

// Уведомления (the bell of the top bar, the /notifications page): one row per recipient.
//
// - recipient_id is the sign-in account (users.id). GET / PATCH / DELETE of /api/notifications
//   only ever see the caller's own rows; a row of someone else answers 404 like a missing one.
// - Rows are written only by real events, through notifyUsers / notifyTemplate below, inside the
//   transaction of the event (getDb() is that transaction): a rolled-back event leaves no
//   notification. Nothing is seeded on a fresh database.
// - title / text are Russian i18n keys that may hold {placeholders}; params (JSON) holds their
//   values (data, never translated). The UI translates the key, then fills the values in.
// - Rows from before notifications had a recipient (recipient_id IS NULL) are hidden, never
//   shown to anyone. The 247 demo rows the old code seeded (another company's orders and
//   cashboxes) are deleted once, matched exactly by lib/user-notifications-legacy-seed.ts.
// - The schema is installed lazily, once per process, on the maintenance pool
//   (outsideTransaction), never inside a request transaction.

export type NotificationParams = Record<string, string | number>

export type UserNotification = {
  id: number
  /** Russian i18n key, may hold {placeholders} filled from params. */
  title: string
  /** Russian i18n key, may hold {placeholders} filled from params. */
  text: string
  template: string
  objectId: number
  /** In-app path the notification opens ("" → the UI's default for the template). */
  link: string
  params: NotificationParams
  viewed: boolean
  /** UTC "YYYY-MM-DDTHH:MM:SS". */
  createdDate: string
}

export type NotificationInput = {
  /** Event name, e.g. "order_delivered" (lowercase letters, digits, "_"). */
  template: string
  /** Russian i18n key (may hold {placeholders}). */
  title: string
  /** Russian i18n key (may hold {placeholders}). */
  text: string
  /** Values of the placeholders (data: names, numbers, formatted amounts). */
  params?: NotificationParams
  /** In-app path, e.g. "/analytics/sales/15". Anything that is not a local path is dropped. */
  link?: string
  /** Id of the object the event is about (order, transfer, supply …), 0 when none. */
  objectId?: number
}

/**
 * The events of Настройки → Уведомления (notification_templates) that this app produces, with
 * the reference's wording as Russian i18n keys. notifyTemplate uses them.
 *
 * Who receives an event (product decision, the same for every template; notifyTemplate applies it):
 *  1. every administrator account (users.role = 'admin'). The company's owners see every event;
 *     their accounts usually have no employee card, and Настройки → Уведомления subscribes
 *     employees only, so without this rule they could never be reached;
 *  2. the sign-in accounts of the employees subscribed to the template in Настройки → Уведомления
 *     (notification_template_users → users.employee_id);
 *  3. the people the event is about, named by the producer (`participants` below): `userIds`,
 *     `employeeIds`, or `employeeNames` for documents that keep the person by name (orders.agent);
 *  minus `exceptUserIds`. The user who caused the event is NOT left out by default: like the
 *  reference, a recipient sees every event, his own included. A template switched off in
 *  Настройки → Уведомления reaches nobody. An employee without a sign-in account (users.employee_id)
 *  cannot receive anything: notifications belong to sign-in accounts.
 */
export const NOTIFICATION_TEMPLATES = {
  order_delivered: {
    title: "Заказ доставлен",
    text: "Заказ №{id} был доставлен клиенту {client} доставщиком {delivery_man}",
    participants: "the order's agent: employeeNames: [orders.agent]",
  },
  transfer_create: {
    title: "Перечислена",
    text: "В {cashboxname} перечислена {amount} {currency_name}, пожалуйста, подтвердите",
    participants: "the cashier of the receiving cashbox, who confirms it: employeeIds: [cashboxes.cashier_id]",
  },
  supply_accepted: {
    title: "Приемка поставки",
    text: "Поставка №{id} была принята на склад {stock_name} пользователем {accepted_by}. Поставщик: {provider_name}",
    participants: "none beyond the administrators and the subscribers",
  },
  new_market: {
    title: "Новый магазин",
    text: "Магазин «{market_name}» добавил {created_by}",
    participants: "the client's agent: employeeNames: [clients.agent]",
  },
  added_return_order: {
    title: "Добавлен возврат",
    text: "Возврат {total_price} {currency} от «{client_name}» добавил {created_by}",
    participants: "the client's agent: employeeNames: [clients.agent]",
  },
  finance_transaction: {
    title: "Добавлен расход",
    text: "Расход {total_price} {currency} по статье «{category_name}» в кассе {cashbox}",
    participants: "the cashier of the cashbox: employeeIds: [cashboxes.cashier_id]",
  },
  new_contract: {
    title: "Новый договор",
    text: "Создан договор №{pk} для клиента {market_name}",
    participants: "the client's agent: employeeNames: [clients.agent]",
  },
  money_request: {
    title: "Новый запрос к оплате",
    text: "Поставщику {provider}: {amount} {currency}. {comment}",
    participants: "none beyond the administrators (who approve it) and the subscribers",
  },
  money_request_approved: {
    title: "Запрос к оплате №{id} подтвержден",
    text: "Поставщику {provider}: {amount} {currency}. {comment}",
    participants: "the account that made the request, when the request stores it: userIds: [its user id]",
  },
} as const satisfies Record<string, { title: string; text: string; participants: string }>

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES

const TEMPLATE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const PARAM_NAME = /^[a-z][a-z0-9_]{0,63}$/i
const MAX_TITLE = 500
const MAX_TEXT = 2000
const MAX_PARAM_VALUE = 500
const MAX_PARAMS = 30
const MAX_LINK = 500
const MAX_RECIPIENTS = 10_000
const MAX_NAMES = 100
const MAX_NAME = 200
/** Largest page the list reads at once. */
export const MAX_NOTIFICATIONS_PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL DEFAULT '',
    object_id INTEGER NOT NULL DEFAULT 0,
    viewed INTEGER NOT NULL DEFAULT 0,
    created_date TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'))
  );
  ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS recipient_id INTEGER;
  ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT '';
  ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS params TEXT NOT NULL DEFAULT '{}';
  CREATE INDEX IF NOT EXISTS user_notifications_recipient_idx ON user_notifications (recipient_id, id DESC);
`

/** Bump when SCHEMA_SQL or the cleanup changes (the promise lives on globalThis across hot reloads). */
const SCHEMA_VERSION = 1

declare global {
  var __linkoUserNotificationsSchema: { version: number; ready: Promise<void> } | undefined
}

/** Deletes the demo rows the old code seeded, and only those: no recipient, and id + content
 * equal to a known seed row (lib/user-notifications-legacy-seed.ts). Any other legacy row stays
 * (hidden: it has no recipient). */
async function purgeLegacySeed(db: PgDb): Promise<void> {
  const ids = LEGACY_NOTIFICATION_SEED.map(([id]) => id)
  const hashes = LEGACY_NOTIFICATION_SEED.map(([, hash]) => hash)
  // Nothing left (every later start): no row lock at all.
  const left = await db
    .prepare("SELECT EXISTS (SELECT 1 FROM user_notifications WHERE recipient_id IS NULL AND id = ANY(@ids::int[])) AS found")
    .get({ ids })
  if (!left?.found) return
  await db
    .prepare(
      `DELETE FROM user_notifications n
       USING unnest(@ids::int[], @hashes::text[]) AS seed(id, hash)
       WHERE n.id = seed.id
         AND n.recipient_id IS NULL
         AND md5(n.id::text || '|' || n.title || '|' || n.text || '|' || n.template || '|' || n.object_id::text || '|' || n.created_date) = seed.hash`,
    )
    .run({ ids, hashes })
}

/**
 * Creates / upgrades the table once per process on the maintenance pool. Producers call it
 * before opening the transaction of their event (like the other ensure…Schema helpers);
 * notifyUsers awaits it too, which is then already settled.
 */
export function ensureUserNotificationsSchema(): Promise<void> {
  const cached = globalThis.__linkoUserNotificationsSchema
  if (cached?.version === SCHEMA_VERSION) return cached.ready
  const entry = { version: SCHEMA_VERSION, ready: Promise.resolve() }
  entry.ready = outsideTransaction(async () => {
    const db = getDb()
    await db.exec(SCHEMA_SQL)
    await purgeLegacySeed(db)
  }).catch((error: unknown) => {
    if (globalThis.__linkoUserNotificationsSchema === entry) globalThis.__linkoUserNotificationsSchema = undefined
    throw error
  })
  globalThis.__linkoUserNotificationsSchema = entry
  return entry.ready
}

// ---------------------------------------------------------------------------
// Reading and changing the caller's own notifications
// ---------------------------------------------------------------------------

type Row = {
  id: number
  title: string
  text: string
  template: string
  object_id: number
  link: string | null
  params: string | null
  viewed: number
  created_date: string
}

function parseParams(raw: string | null): NotificationParams {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    const params: NotificationParams = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) params[key] = item
    }
    return params
  } catch {
    return {}
  }
}

function rowToNotification(row: Row): UserNotification {
  return {
    id: Number(row.id),
    title: row.title,
    text: row.text,
    template: row.template,
    objectId: Number(row.object_id) || 0,
    link: row.link ?? "",
    params: parseParams(row.params),
    viewed: Boolean(row.viewed),
    createdDate: row.created_date,
  }
}

function assertRecipient(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0 || userId > MAX_DB_ID) throw new Error("user-notifications: invalid recipient id")
}

/**
 * The caller's notifications, newest first. `beforeId` (a cursor: the last id already shown)
 * reads the next page without skipping rows when some were deleted meanwhile; without it,
 * `page` counts from the newest.
 */
export async function listUserNotifications(
  userId: number,
  options: { page: number; pageSize: number; beforeId?: number | null },
): Promise<{ count: number; unviewed: number; results: UserNotification[] }> {
  assertRecipient(userId)
  await ensureUserNotificationsSchema()
  const db = getDb()
  const pageSize = Math.min(MAX_NOTIFICATIONS_PAGE_SIZE, Math.max(1, Math.trunc(options.pageSize)))
  const counts = (await db
    .prepare(
      "SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE viewed = 0) AS unviewed FROM user_notifications WHERE recipient_id = @userId",
    )
    .get({ userId })) as { count: number | string; unviewed: number | string }
  const columns = "id, title, text, template, object_id, link, params, viewed, created_date"
  const rows = (
    options.beforeId
      ? await db
          .prepare(`SELECT ${columns} FROM user_notifications WHERE recipient_id = @userId AND id < @beforeId ORDER BY id DESC LIMIT @limit`)
          .all({ userId, beforeId: options.beforeId, limit: pageSize })
      : await db
          .prepare(`SELECT ${columns} FROM user_notifications WHERE recipient_id = @userId ORDER BY id DESC LIMIT @limit OFFSET @offset`)
          .all({ userId, limit: pageSize, offset: (Math.max(1, Math.trunc(options.page)) - 1) * pageSize })
  ) as Row[]
  return { count: Number(counts.count), unviewed: Number(counts.unviewed), results: rows.map(rowToNotification) }
}

/** Marks one of the caller's notifications viewed; false when it is not theirs or missing. */
export async function markUserNotificationViewed(userId: number, id: number): Promise<boolean> {
  assertRecipient(userId)
  await ensureUserNotificationsSchema()
  const result = await getDb().prepare("UPDATE user_notifications SET viewed = 1 WHERE id = @id AND recipient_id = @userId").run({ id, userId })
  return result.changes > 0
}

/** Marks every unviewed notification of the caller viewed (nobody else's); returns how many. */
export async function markAllUserNotificationsViewed(userId: number): Promise<number> {
  assertRecipient(userId)
  await ensureUserNotificationsSchema()
  const result = await getDb().prepare("UPDATE user_notifications SET viewed = 1 WHERE recipient_id = @userId AND viewed = 0").run({ userId })
  return result.changes
}

/** Deletes one of the caller's notifications; false when it is not theirs or missing. */
export async function deleteUserNotification(userId: number, id: number): Promise<boolean> {
  assertRecipient(userId)
  await ensureUserNotificationsSchema()
  const result = await getDb().prepare("DELETE FROM user_notifications WHERE id = @id AND recipient_id = @userId").run({ id, userId })
  return result.changes > 0
}

// ---------------------------------------------------------------------------
// Producing notifications (called by the modules whose events they report)
// ---------------------------------------------------------------------------

/** Folds control characters to a space and caps the length. */
function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max)
}

function cleanParams(params: NotificationParams | undefined): string {
  const out: NotificationParams = {}
  let count = 0
  for (const [key, value] of Object.entries(params ?? {})) {
    if (count >= MAX_PARAMS || !PARAM_NAME.test(key)) continue
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue
      out[key] = value
    } else if (typeof value === "string") out[key] = cleanText(value, MAX_PARAM_VALUE)
    else continue
    count++
  }
  return JSON.stringify(out)
}

/** A local path of this app ("/analytics/sales/15"), else "": never another site ("//x", "https:"). */
function cleanLink(link: string | undefined): string {
  const value = String(link ?? "").trim()
  if (!value || value.length > MAX_LINK) return ""
  return /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : ""
}

function cleanIds(ids: Iterable<unknown> | undefined): number[] {
  const out = new Set<number>()
  for (const value of ids ?? []) {
    const id = strictId(value)
    if (id !== null) out.add(id)
    if (out.size >= MAX_RECIPIENTS) break
  }
  return [...out]
}

/**
 * Writes one notification per sign-in account in `userIds` (users.id; unknown ids and
 * duplicates are skipped) and returns how many were written.
 *
 * Call it inside the transaction of the event (getDb() is then that transaction), after the
 * event's own writes: the notification commits or rolls back with the event. It runs in a
 * savepoint and never throws for a database error: a notification that cannot be written
 * must not undo the order / payment it reports (it is logged instead). Await
 * ensureUserNotificationsSchema() before opening the transaction.
 */
export async function notifyUsers(userIds: Iterable<number>, input: NotificationInput): Promise<number> {
  const ids = cleanIds(userIds)
  const template = String(input.template ?? "").trim()
  if (!TEMPLATE_NAME.test(template)) throw new Error(`user-notifications: invalid template name "${template}"`)
  const title = cleanText(input.title, MAX_TITLE)
  const text = cleanText(input.text, MAX_TEXT)
  if (!ids.length || (!title && !text)) return 0
  const objectId = strictId(input.objectId) ?? 0
  try {
    await ensureUserNotificationsSchema()
    return await isolated(async () => {
      const result = await getDb()
        .prepare(
          `INSERT INTO user_notifications (recipient_id, title, text, template, object_id, link, params)
           SELECT u.id, @title, @text, @template, @objectId, @link, @params FROM users u WHERE u.id = ANY(@ids::int[]) ORDER BY u.id`,
        )
        .run({ ids, title, text, template, objectId, link: cleanLink(input.link), params: cleanParams(input.params) })
      return result.changes
    })
  } catch (error) {
    console.warn(`[notifications] "${template}" was not written:`, error instanceof Error ? error.message : error)
    return 0
  }
}

/** True when the table exists (another module creates it lazily; reading never runs its DDL). */
async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS found").get({ table })) as { found: boolean } | undefined
  return Boolean(row?.found)
}

/** Distinct non-empty names (control characters folded, capped), at most MAX_NAMES. */
function cleanNames(names: Iterable<unknown> | undefined): string[] {
  const out = new Set<string>()
  for (const value of names ?? []) {
    if (typeof value !== "string") continue
    const name = cleanText(value, MAX_NAME)
    if (name) out.add(name)
    if (out.size >= MAX_NAMES) break
  }
  return [...out]
}

/** Employees named "First Last" (compared like orders.agent is resolved: case, NBSP and spaces
 * ignored). A name that matches several employees is ambiguous and skipped: a notification must
 * never reach a namesake. */
async function employeeIdsByName(db: PgDb, names: string[]): Promise<number[]> {
  if (!names.length || !(await tableExists(db, "employees"))) return []
  const rows = (await db
    .prepare(
      `SELECT min(e.id) AS id
         FROM (SELECT DISTINCT ${keySql("n.name")} AS k FROM unnest(@names::text[]) AS n(name)) wanted
         JOIN employees e ON ${keySql("e.first_name || ' ' || e.last_name")} = wanted.k
        WHERE wanted.k <> ''
        GROUP BY wanted.k
       HAVING count(*) = 1`,
    )
    .all({ names })) as { id: number }[]
  return cleanIds(rows.map((row) => row.id))
}

export type NotifyTemplateOptions = {
  /** Id of the object the event is about (order, transfer, supply …). */
  objectId?: number
  /** In-app path the notification opens. */
  link?: string
  /** Participants by sign-in account (users.id). */
  userIds?: number[]
  /** Participants by employee card (employees.id → their sign-in account). */
  employeeIds?: number[]
  /** Participants by employee name ("First Last", e.g. orders.agent); ambiguous names are skipped. */
  employeeNames?: string[]
  /** Accounts that must not receive this event. */
  exceptUserIds?: number[]
}

/**
 * Reports an event of Настройки → Уведомления to the audience described at
 * NOTIFICATION_TEMPLATES: the administrators, the accounts of the employees subscribed to the
 * template, and the participants the caller names (`userIds` / `employeeIds` /
 * `employeeNames`), minus `exceptUserIds`. Nothing is written while the template is switched off.
 * Same transaction rules as notifyUsers; returns how many notifications were written.
 */
export async function notifyTemplate(name: NotificationTemplateName, params: NotificationParams, options: NotifyTemplateOptions = {}): Promise<number> {
  const template = NOTIFICATION_TEMPLATES[name]
  if (!template) throw new Error(`user-notifications: unknown template "${String(name)}"`)
  try {
    const recipients = await isolated(async () => {
      const db = getDb()
      const employeeIds = cleanIds(options.employeeIds)
      if (await tableExists(db, "notification_templates")) {
        const row = (await db.prepare("SELECT id, status FROM notification_templates WHERE name = @name").get({ name })) as
          | { id: number; status: string }
          | undefined
        if (row?.status === "off") return []
        if (row && (await tableExists(db, "notification_template_users"))) {
          const links = (await db.prepare("SELECT user_id FROM notification_template_users WHERE template_id = @id").all({ id: row.id })) as {
            user_id: number
          }[]
          employeeIds.push(...cleanIds(links.map((link) => link.user_id)))
        }
      }
      employeeIds.push(...(await employeeIdsByName(db, cleanNames(options.employeeNames))))
      const wantedEmployees = cleanIds(employeeIds)
      // users.employee_id is added lazily by lib/auth-employee.ts: read through to_jsonb so a
      // database without the column still reaches the administrators.
      const accounts = (await db
        .prepare(
          `SELECT u.id FROM users u
            WHERE u.role = 'admin' OR (to_jsonb(u) ->> 'employee_id')::bigint = ANY(@employeeIds::int[])
            ORDER BY u.id`,
        )
        .all({ employeeIds: wantedEmployees })) as { id: number }[]
      const except = new Set(cleanIds(options.exceptUserIds))
      return cleanIds([...cleanIds(options.userIds), ...accounts.map((account) => account.id)]).filter((id) => !except.has(id))
    })
    if (!recipients.length) return 0
    return await notifyUsers(recipients, { template: name, title: template.title, text: template.text, params, link: options.link, objectId: options.objectId })
  } catch (error) {
    console.warn(`[notifications] "${name}" recipients were not resolved:`, error instanceof Error ? error.message : error)
    return 0
  }
}
