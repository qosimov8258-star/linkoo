// Ограничение времени (Персонал → Заказ → "Ограничение времени"): the shared rules of
// the order time windows, used by the server (validation, enforcement) and by the page
// (labels, form checks). No server-only import.
//
// There are exactly two system restrictions, one per guarded order action. Nobody
// creates or deletes them; an administrator only sets when the action is allowed:
//   1 Работает полный день        — allowed all day (no restriction);
//   2 Не работает в течении дня   — refused the whole day;
//   3 Работает в данные часы      — allowed only inside [Начало, Конец);
//   4 Не работает в данные часы   — refused inside [Начало, Конец).
// A window whose Конец is earlier than its Начало runs over midnight (22:00 – 06:00).
// Начало and Конец must differ. Times are compared with the Asia/Tashkent clock.
//
// Who is restricted: a signed-in account linked to an employee (Сотрудники), i.e. an agent
// working in the field — administrators and office accounts without an employee are never
// restricted. "Действует для всех" (isAll) restricts every such account;
// "Действует только для выбранных агентов" only the employees assigned to the restriction.

export const ORDER_TIME_ACTIONS = ["create", "edit"] as const
export type OrderTimeAction = (typeof ORDER_TIME_ACTIONS)[number]

/** Stable code of each system row → its action. */
export const ORDER_TIME_CODES = { order_create: "create", order_edit: "edit" } as const
export type OrderTimeCode = keyof typeof ORDER_TIME_CODES

/** Russian i18n key of each system row's name (the reference app's own names). */
export const ORDER_TIME_NAMES: Record<OrderTimeCode, string> = {
  order_create: "Создания заказа",
  order_edit: "Редактировать заказ",
}

export const ORDER_TIME_STATUSES = [1, 2, 3, 4] as const
export type OrderTimeStatus = (typeof ORDER_TIME_STATUSES)[number]

/** Russian i18n keys of the "Тип" options, in the reference order. */
export const ORDER_TIME_STATUS_LABELS: Record<OrderTimeStatus, string> = {
  1: "Работает полный день",
  2: "Не работает в течении дня",
  3: "Работает в данные часы",
  4: "Не работает в данные часы",
}

/** Statuses that need Начало and Конец. */
export function statusNeedsTimes(status: number): boolean {
  return status === 3 || status === 4
}

export function isOrderTimeStatus(value: unknown): value is OrderTimeStatus {
  return typeof value === "number" && (ORDER_TIME_STATUSES as readonly number[]).includes(value)
}

/** Most employees one restriction may list (a request is refused above it). */
export const MAX_RESTRICTION_EMPLOYEES = 2000

// Russian i18n keys of the refusals (client form and server answers alike).
export const MSG_STATUS_REQUIRED = "Выберите тип"
export const MSG_FROM_REQUIRED = "Укажите время начала"
export const MSG_TO_REQUIRED = "Укажите время окончания"
export const MSG_TIME_INVALID = "Неверное время"
export const MSG_TIMES_EQUAL = "Время начала и окончания не должны совпадать"
export const MSG_IS_ALL_REQUIRED = "Выберите, для кого действует ограничение"
export const MSG_EMPLOYEE_NOT_FOUND = "Сотрудник не найден"
export const MSG_RESTRICTION_NOT_FOUND = "Ограничение не найдено"
export const MSG_CREATE_BLOCKED = "Создание заказа запрещено в это время"
export const MSG_EDIT_BLOCKED = "Редактирование заказа запрещено в это время"

/** "HH:MM" or "HH:MM:SS" (24 h) → seconds of the day; anything else → null. */
export function clockSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")]
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds
}

/** A stored / typed time → "HH:MM" (what the page shows and the form edits); "" when invalid. */
export function clockText(value: unknown): string {
  const seconds = clockSeconds(value)
  if (seconds === null) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}`
}

/** True when `now` (seconds of the day) is inside [from, to); over midnight when to < from. */
export function insideWindow(now: number, from: number, to: number): boolean {
  return from < to ? now >= from && now < to : now >= from || now < to
}

/** Whether the action is allowed at `now` (seconds of the day, Asia/Tashkent) under the rule.
 * A status 3 / 4 row without valid times (never stored, see the table checks) restricts nothing. */
export function allowedAt(status: number, fromTime: string | null, toTime: string | null, now: number): boolean {
  if (status === 2) return false
  if (!statusNeedsTimes(status)) return true
  const from = clockSeconds(fromTime)
  const to = clockSeconds(toTime)
  if (from === null || to === null || from === to) return true
  const inside = insideWindow(now, from, to)
  return status === 3 ? inside : !inside
}

/** Seconds of the day of an Asia/Tashkent "YYYY-MM-DDTHH:mm:ss" text (lib/finance/dates.ts nowLocalIso). */
export function localIsoSeconds(localIso: string): number {
  return clockSeconds(localIso.slice(11, 19)) ?? 0
}

export type OrderTimeDraft = { status: number | null; fromTime: string; toTime: string }
export type OrderTimeFieldErrors = Partial<Record<"status" | "fromTime" | "toTime", string>>

/** Field errors of the "Время работы" form (Russian i18n keys); {} when it can be saved. */
export function orderTimeDraftErrors(draft: OrderTimeDraft): OrderTimeFieldErrors {
  const errors: OrderTimeFieldErrors = {}
  if (!isOrderTimeStatus(draft.status)) {
    errors.status = MSG_STATUS_REQUIRED
    return errors
  }
  if (!statusNeedsTimes(draft.status)) return errors
  const from = draft.fromTime.trim() ? clockSeconds(draft.fromTime) : undefined
  const to = draft.toTime.trim() ? clockSeconds(draft.toTime) : undefined
  if (from === undefined) errors.fromTime = MSG_FROM_REQUIRED
  else if (from === null) errors.fromTime = MSG_TIME_INVALID
  if (to === undefined) errors.toTime = MSG_TO_REQUIRED
  else if (to === null) errors.toTime = MSG_TIME_INVALID
  if (typeof from === "number" && typeof to === "number" && Math.floor(from / 60) === Math.floor(to / 60)) errors.toTime = MSG_TIMES_EQUAL
  return errors
}

/** A row of GET /api/order-time-restrictions. */
export type OrderTimeRestriction = {
  id: number
  code: OrderTimeCode
  /** Russian i18n key of the name (ORDER_TIME_NAMES). */
  name: string
  status: OrderTimeStatus
  /** "HH:MM", or null for statuses 1 and 2. */
  fromTime: string | null
  toTime: string | null
  isAll: boolean
  /** Employees the restriction is limited to (used while isAll is false). */
  employees: Array<{ id: number; name: string; position: string; active: boolean }>
  updatedAt: string
}

export type OrderTimeRestrictionPage = { count: number; page: number; pageSize: number; results: OrderTimeRestriction[] }

/** Page sizes of the list (the reference's select). */
export const ORDER_TIME_PAGE_SIZES = [10, 25, 50, 100] as const

/** "Работает в данные часы: 09:00 - 18:00" in the UI language; a missing time is "∞". */
export function workingTimeText(row: Pick<OrderTimeRestriction, "status" | "fromTime" | "toTime">, t: (text: string) => string): string {
  const label = t(ORDER_TIME_STATUS_LABELS[row.status] ?? ORDER_TIME_STATUS_LABELS[1])
  if (!statusNeedsTimes(row.status)) return label
  return `${label}: ${clockText(row.fromTime) || "∞"} - ${clockText(row.toTime) || "∞"}`
}
