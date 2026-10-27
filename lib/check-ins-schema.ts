import { z } from "zod"

import { dbId } from "@/lib/strict-number"

// Request bodies of the check-in APIs (Посещаемость):
// - POST /api/mobile/check-ins: the mobile app of the signed-in employee (idempotency key required);
// - POST /api/work-attendance/check-ins: a manager registers a check-in for an employee.
// Messages are Russian i18n keys.

export const COORDINATES_INVALID = "Неверные координаты"
export const IDEMPOTENCY_KEY_INVALID = "Неверный ключ повтора"

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** Optional number in [min, max]: a JSON number or a plain decimal text; null / "" / absent = none. */
function optionalNumber(min: number, max: number, message: string) {
  return z.preprocess(
    (value, ctx) => {
      if (value === undefined || value === null) return null
      if (typeof value === "string" && !value.trim()) return null
      const number = typeof value === "number" ? value : typeof value === "string" && value.trim().length <= 40 && DECIMAL.test(value.trim()) ? Number(value) : Number.NaN
      if (!Number.isFinite(number) || number < min || number > max) {
        ctx.issues.push({ code: "custom", message, input: value })
        return z.NEVER
      }
      return number
    },
    z.number().nullable(),
  )
}

const text = (max: number, message: string) => z.string({ error: "Неверное значение" }).trim().max(max, message).optional()

const base = {
  kind: z.enum(["in", "out"], { error: "Укажите тип отметки: приход или уход" }),
  /** The moment of the event: ISO date-time, preferably with the offset ("2026-10-26T08:51:00+05:00"); absent = now. */
  at: z.string({ error: "Неверная дата" }).trim().max(40, "Неверная дата").optional(),
  lat: optionalNumber(-90, 90, COORDINATES_INVALID),
  lng: optionalNumber(-180, 180, COORDINATES_INVALID),
  accuracy: optionalNumber(0, 100_000, "Неверная точность GPS"),
  place: text(200, "Не более 200 символов"),
  comment: text(500, "Не более 500 символов"),
  deviceId: text(100, "Не более 100 символов"),
}

const idempotencyKey = z
  .string({ error: IDEMPOTENCY_KEY_INVALID })
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{8,100}$/, IDEMPOTENCY_KEY_INVALID)

function coordinatesTogether(value: { lat: number | null; lng: number | null }, ctx: z.RefinementCtx) {
  if ((value.lat === null) !== (value.lng === null)) ctx.addIssue({ code: "custom", message: COORDINATES_INVALID, path: [value.lat === null ? "lat" : "lng"] })
  else if (value.lat === 0 && value.lng === 0) ctx.addIssue({ code: "custom", message: COORDINATES_INVALID, path: ["lat"] })
}

export const mobileCheckInSchema = z.object({ ...base, idempotencyKey }).superRefine(coordinatesTogether)

export const managerCheckInSchema = z
  .object({ ...base, employeeId: dbId("Сотрудник не найден"), idempotencyKey: idempotencyKey.optional() })
  .superRefine(coordinatesTogether)

export type MobileCheckInBody = z.infer<typeof mobileCheckInSchema>
export type ManagerCheckInBody = z.infer<typeof managerCheckInSchema>
