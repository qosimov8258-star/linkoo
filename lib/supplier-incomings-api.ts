import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { IncomingChange } from "@/lib/supplier-incomings-repo"
import { MAX_MONEY, optionalAmount, optionalText as text, priceSchema, quantitySchema } from "@/lib/supplier-refs"
import { dbId, strictNum } from "@/lib/strict-number"

// Request schemas of /api/supplier-incomings/** ("Приход от поставщиков").
// Bounds (contract): money |x| ≤ 1e13, quantity 0 < x ≤ 1e9. Every message is a
// Russian i18n key; the first failing one is the response `error`.

export const incomingItemSchema = z
  .object({
    id: z.unknown().optional(),
    /** Catalog key from a picker ("product:12" / "raw_material:3"), optional. */
    key: text(200),
    product: z.string({ error: "Выберите товар" }).trim().min(1, "Выберите товар").max(500, "Не более 500 символов"),
    expiry: text(100),
    /** The line's series number (products with «Серия»). */
    series: text(100),
    qty: quantitySchema,
    block: optionalAmount,
    kg: optionalAmount,
    netWeight: optionalAmount,
    cost: priceSchema,
    total: z.unknown().optional(),
  })
  .refine((item) => item.qty * item.cost <= MAX_MONEY, { message: "Слишком большая сумма строки", path: ["cost"] })

export const supplierIncomingSchema = z
  .object({
    supplier: z.string({ error: "Выберите поставщика" }).trim().min(1, "Выберите поставщика").max(255, "Не более 255 символов"),
    warehouse: z.string({ error: "Выберите склад" }).trim().min(1, "Выберите склад").max(255, "Не более 255 символов"),
    branch: text(255),
    organization: text(255),
    paymentType: z.preprocess((value) => (value === null || value === "" ? undefined : value), z.enum(["Банковский счет", "Наличный"], { error: "Неверный тип оплаты" }).optional()),
    currency: text(12),
    /** Any parseable date; stored as YYYY-MM-DD (default today). The repo applies the document
     * date rule (lib/document-dates.ts): year 2000..2100, not after today (an edit may keep its day). */
    date: text(60),
    contractNumber: text(200),
    invoiceNumber: text(200),
    /** The supplier's invoice date: any parseable date of a year 2000..2100, stored as YYYY-MM-DD. */
    invoiceDate: text(60),
    /** «Ожидаемый выход с завода» / «Ожидаемое прибытие в таможню»: any parseable day of a year 2000..2100. */
    expectedFactoryExit: text(60),
    expectedCustomsArrival: text(60),
    comment: text(2000),
    items: z.array(incomingItemSchema, { error: "Добавьте товары" }).min(1, "Добавьте товары").max(1000, "Не более 1000 строк"),
    /** "Создать приход" from an accepted incoming e-invoice (create only). */
    invoiceId: dbId().nullable().optional(),
  })
  .refine((body) => body.items.reduce((sum, item) => sum + item.qty * item.cost, 0) <= MAX_MONEY, { message: "Слишком большая сумма поставки", path: ["items"] })

export type SupplierIncomingBody = z.infer<typeof supplierIncomingSchema>

/** POST /api/supplier-incomings/[id]/expenses — "Добавить расход". */
export const incomingExpenseSchema = z.object({
  /** Any parseable date; stored as YYYY-MM-DD (default today); year 2000..2100, not after today
   * (a money document, lib/document-dates.ts). */
  date: text(60),
  description: z.string({ error: "Укажите описание расхода" }).trim().min(1, "Укажите описание расхода").max(500, "Не более 500 символов"),
  amount: strictNum(z.number({ error: "Сумма должна быть числом" }).gt(0, "Сумма должна быть больше 0").max(MAX_MONEY, "Слишком большая сумма"), "Сумма должна быть числом"),
  currency: text(12),
  paymentType: text(100),
})

export type IncomingExpenseBody = z.infer<typeof incomingExpenseSchema>

/** POST /api/supplier-incomings/[id]/invoice — «Изменить детали счет фактуры». The day is required (checked by the repo,
 * a field error). */
export const incomingInvoiceSchema = z.object({
  invoiceNumber: text(200),
  invoiceDate: text(60),
  invoiceComment: text(2000),
})

/** POST /api/supplier-incomings/[id]/logs — «Добавить лог»: «Вышел с завода» / «Прибыл в таможню» on a day (default
 * today) with a comment. */
export const incomingEventLogSchema = z.object({
  action: z.enum(["sent_out", "come_to_post"], { error: "Выберите статус" }),
  date: text(60),
  comment: text(2000),
})

export function incomingChangeResponse(result: IncomingChange, lockedMessage: string) {
  if (result === "not_found") return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: lockedMessage }, { status: 409 })
  return NextResponse.json(result)
}

export const incomingNotFound = () => NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
