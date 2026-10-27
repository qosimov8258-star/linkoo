import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { docYearOk } from "@/lib/document-dates"
import { MAX_MONEY, MAX_QTY, OrderError } from "@/lib/orders-repo"
import { ORDER_STATUSES } from "@/components/orders/orders-data"

// Request schemas of /api/orders/** (messages are Russian i18n keys).

const MAX_ID = 2_147_483_647
const id = z.number({ error: "Неверный идентификатор" }).int({ error: "Неверный идентификатор" }).positive({ error: "Неверный идентификатор" }).max(MAX_ID, { error: "Неверный идентификатор" })
const text = (max: number) => z.string({ error: "Неверные данные" }).trim().max(max, { error: "Слишком длинное значение" })
/** A real calendar day "YYYY-MM-DD" (2026-02-31 is refused). */
const isCalendarDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
/** Years a business document can sensibly carry (0001-01-01 or 9999-12-31 are typos): the shared document rule. */
const saneYear = (value: string) => docYearOk(value)
const isoDay = z.union([
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Дата: формат YYYY-MM-DD" })
    .refine(isCalendarDay, { error: "Несуществующая дата" })
    .refine(saneYear, { error: "Неверная дата" }),
  z.literal(""),
])
/** Delivery: free text ("—", "21 окт. 2026"), but a "YYYY-MM-DD…" value must be a real day of a sane year. */
const deliveryDay = z
  .string({ error: "Неверные данные" })
  .trim()
  .max(60, { error: "Слишком длинное значение" })
  .refine((value) => !/^\d{4}-\d{2}-\d{2}/.test(value) || (isCalendarDay(value.slice(0, 10)) && saneYear(value)), { error: "Неверная дата" })
const money = z.union([z.string().trim().max(60, { error: "Слишком длинное значение" }), z.number().finite()])

export const orderLineSchema = z.object({
  productId: id.optional(),
  productName: text(300).optional(),
  unit: text(50).optional(),
  quantity: z.number({ error: "Укажите количество" }).finite().gt(0, { error: "Количество должно быть больше 0" }).max(MAX_QTY, { error: "Количество слишком большое" }),
  unitPrice: z.number({ error: "Укажите цену" }).finite().min(0, { error: "Цена не может быть отрицательной" }).max(MAX_MONEY, { error: "Цена слишком большая" }),
  costPrice: z.number().finite().min(0, { error: "Неверная себестоимость" }).max(MAX_MONEY, { error: "Неверная себестоимость" }).optional(),
  discountPercent: z.number().finite().min(0, { error: "Скидка должна быть от 0 до 100%" }).max(100, { error: "Скидка должна быть от 0 до 100%" }).optional(),
  currency: text(10).optional(),
}).refine((value) => value.productId !== undefined || Boolean(value.productName), { error: "Укажите товар", path: ["productId"] })

const status = z.enum(ORDER_STATUSES, { error: `Неизвестный статус. Допустимо: ${ORDER_STATUSES.join(", ")}` })

const orderFields = {
  clientId: id.optional(),
  client: text(300).optional(),
  zone: text(200).optional(),
  type: text(200).optional(),
  product: text(2000).optional(),
  delivery: deliveryDay.optional(),
  agent: text(200).optional(),
  amount: money.optional(),
  currency: text(10).optional(),
  status: status.optional(),
  discount: text(60).optional(),
  paymentDate: isoDay.optional(),
  paymentType: z.enum(["cash", "bank", ""], { error: "Тип оплаты: cash | bank" }).optional(),
  organization: text(200).optional(),
  warehouse: text(200).optional(),
  deliveryMan: text(200).optional(),
  priceList: text(200).optional(),
  comment: text(1000).optional(),
  deliveryType: text(60).optional(),
  dealType: z.enum(["standard", "consignment", ""], { error: "Тип сделки: standard | consignment" }).optional(),
  // Read-only fields older clients send back; ignored.
  balance: z.unknown().optional(),
  negative: z.unknown().optional(),
}

export const orderCreateSchema = z
  .object({ ...orderFields, items: z.array(orderLineSchema).max(500, { error: "Слишком много позиций" }).optional() })
  .refine((value) => value.clientId !== undefined || Boolean(value.client), { error: "Укажите клиента", path: ["client"] })

export const orderPatchSchema = z.object({
  ...orderFields,
  created: text(60).optional(),
  invoiceNumber: text(100).optional(),
  invoiceDate: isoDay.optional(),
  invoiceActive: z.boolean().optional(),
  contract: text(200).optional(),
})

/** Positive integer id of a route segment, or null (→ 404). */
export function routeId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null
  const value = Number(raw)
  return value > 0 && value <= MAX_ID ? value : null
}

export function orderErrorResponse(error: unknown): NextResponse {
  if (error instanceof OrderError) return NextResponse.json({ error: error.message, ...(error.extra ?? {}) }, { status: error.status })
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}
