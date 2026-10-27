import { z } from "zod"

import { dbId } from "@/lib/strict-number"
import {
  MAX_RESTRICTION_EMPLOYEES,
  MSG_EMPLOYEE_NOT_FOUND,
  MSG_IS_ALL_REQUIRED,
  MSG_STATUS_REQUIRED,
  ORDER_TIME_ACTIONS,
  clockText,
  orderTimeDraftErrors,
  statusNeedsTimes,
  type OrderTimeAction,
  type OrderTimeStatus,
} from "@/lib/order-time-restrictions-rules"

// Body of PUT /api/order-time-restrictions/[id] (the "Время работы" dialog). Every
// refusal is a Russian i18n key. Начало / Конец are kept only for statuses 3 and 4
// (statuses 1 and 2 store none, whatever was sent).

/** Тип: 1..4 as a JSON number or a one-digit text ("1", as the list returns it in the reference). */
const statusField = z.preprocess(
  (value) => (typeof value === "string" && /^\s*[1-4]\s*$/.test(value) ? Number(value) : value),
  z.number({ error: MSG_STATUS_REQUIRED }).refine((value) => Number.isInteger(value) && value >= 1 && value <= 4, MSG_STATUS_REQUIRED),
)

const timeField = z.string({ error: "Неверное время" }).max(20, "Неверное время").nullable().optional()

export const orderTimeRestrictionUpdateSchema = z
  .object({
    status: statusField,
    fromTime: timeField,
    toTime: timeField,
    isAll: z.boolean({ error: MSG_IS_ALL_REQUIRED }),
    /** Employees the restriction is limited to; omitted = keep the current list. */
    employeeIds: z.array(dbId(MSG_EMPLOYEE_NOT_FOUND)).max(MAX_RESTRICTION_EMPLOYEES, "Слишком много сотрудников").optional(),
  })
  .superRefine((value, ctx) => {
    const errors = orderTimeDraftErrors({ status: value.status, fromTime: value.fromTime ?? "", toTime: value.toTime ?? "" })
    for (const [field, message] of Object.entries(errors)) ctx.addIssue({ code: "custom", path: [field], message })
  })
  .transform((value) => {
    const status = value.status as OrderTimeStatus
    const times = statusNeedsTimes(status)
    return {
      status,
      fromTime: times ? normalizeClock(value.fromTime) : null,
      toTime: times ? normalizeClock(value.toTime) : null,
      isAll: value.isAll,
      employeeIds: value.employeeIds ? [...new Set(value.employeeIds)] : undefined,
    }
  })

export type OrderTimeRestrictionUpdate = z.output<typeof orderTimeRestrictionUpdateSchema>

/** A validated "HH:MM" / "HH:MM:SS" → "HH:MM:SS" for the TIME column. */
function normalizeClock(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim()
  const short = clockText(text)
  if (!short) return null
  return text.length === 8 ? text : `${short}:00`
}

/** ?action= of the check endpoint. */
export function parseOrderTimeAction(value: string | null): OrderTimeAction | null {
  return (ORDER_TIME_ACTIONS as readonly string[]).includes(value ?? "") ? (value as OrderTimeAction) : null
}
