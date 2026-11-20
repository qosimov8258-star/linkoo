import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { CurrentUser } from "@/lib/current-user"
import { todayIso } from "@/lib/finance/dates"
import { MAX_MONEY, MAX_QTY } from "@/lib/orders-repo"

// Request schemas of /api/client-returns/** (messages are Russian i18n keys).

const MAX_ID = 2_147_483_647
const id = z.number({ error: "Неверный идентификатор" }).int({ error: "Неверный идентификатор" }).positive({ error: "Неверный идентификатор" }).max(MAX_ID, { error: "Неверный идентификатор" })
const text = (max: number) => z.string({ error: "Неверные данные" }).trim().max(max, { error: "Слишком длинное значение" })

const line = z
  .object({
    /** The edited return's own line this one stands for (Linko's from_client_update sends it). */
    id: id.optional(),
    orderItemId: id.optional(),
    productId: id.optional(),
    productName: text(300).optional(),
    quantity: z.number({ error: "Укажите количество" }).finite().gt(0, { error: "Количество должно быть больше 0" }).max(MAX_QTY, { error: "Количество слишком большое" }),
    price: z.number().finite().min(0, { error: "Цена не может быть отрицательной" }).max(MAX_MONEY, { error: "Цена слишком большая" }).optional(),
  })
  .refine((value) => value.orderItemId !== undefined || value.productId !== undefined || Boolean(value.productName), { error: "Укажите товар", path: ["productId"] })

const fields = {
  clientId: id.optional(),
  client: text(300).optional(),
  warehouse: text(200).optional(),
  orderId: id.optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Дата: формат YYYY-MM-DD" }).optional(),
  currency: text(10).optional(),
  comment: text(1000).optional(),
  deliverer: text(200).optional(),
  agent: text(200).optional(),
  organization: text(200).optional(),
  paymentType: z.enum(["cash", "bank"], { error: "Неверные данные" }).optional(),
  /** «Прайс лист» of a return without an order (Linko's price_list), by name; "" = none. */
  priceList: text(200).optional(),
  items: z.array(line).max(500, { error: "Слишком много позиций" }).optional(),
}

/** orderId null: a return of a client without an order, even when its lines are of one order (the form's
 * «Возврат по конкретному клиенту» without «Возврат по конкретному заказу»). */
export const clientReturnCreateSchema = z
  .object({ ...fields, orderId: id.nullable().optional(), full: z.boolean().optional(), accept: z.boolean().optional() })
  .refine((value) => value.clientId !== undefined || Boolean(value.client), { error: "Укажите клиента", path: ["client"] })

/** An edit may clear the order (null): a client return over several orders, or a client changed in the form. */
export const clientReturnUpdateSchema = z.object({ ...fields, orderId: id.nullable().optional() })

/** POST /api/client-returns/preview: the form of «Добавление возврата» / «Изменение возврата» (returnId) before
 * «Оформить возврат» (Linko's client_return_preview). `kind` = the form's mode, for its required fields. */
export const clientReturnPreviewSchema = z.object({
  ...fields,
  orderId: id.nullable().optional(),
  returnId: id.optional(),
  kind: z.enum(["client", "orders", "old"], { error: "Неверные данные" }).optional(),
})

/** «Принять на склад»: the day of the acceptance (Linko's «Дата»), default today. */
const acceptDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Дата: формат YYYY-MM-DD" }).optional()

export const clientReturnAcceptSchema = z.object({ ids: z.array(id).min(1, { error: "Выберите возвраты" }).max(500, { error: "Слишком много возвратов" }), date: acceptDate })

/** POST /api/client-returns/[id]/accept: an optional body {date}. */
export const clientReturnAcceptOneSchema = z.object({ date: acceptDate })

/** Linko shows the acceptance «Дата» only with can_manage_stock_date (an administrator here, as the card's own
 * «Дата»): anyone else accepts now, so another day than today from them is refused (403). */
export function stockDateRefusal(user: Pick<CurrentUser, "role">, date: string | undefined): NextResponse | null {
  if (!date || date === todayIso() || user.role === "admin") return null
  return NextResponse.json({ error: "У вас нет прав на это действие" }, { status: 403 })
}

/** PATCH /api/client-returns/[id]: a status action (as PATCH /api/supplier-incomings/[id]). */
export const clientReturnActionSchema = z.object({
  action: z.enum(["accept", "unaccept", "cancel"], { error: "Действие: accept | unaccept | cancel" }),
})

const isoDay = /^\d{4}-\d{2}-\d{2}$/

export function parseClientReturnQuery(url: string): { data?: import("@/lib/client-returns-repo").ClientReturnQuery; error?: string } {
  const search = new URL(url).searchParams
  const tab = search.get("tab") ?? "all"
  if (!["pending", "accepted", "cancelled", "all"].includes(tab)) return { error: "Неверные данные" }
  const from = search.get("from") ?? ""
  const to = search.get("to") ?? ""
  if ((from && !isoDay.test(from)) || (to && !isoDay.test(to))) return { error: "Неверная дата" }
  const num = (name: string) => {
    const raw = search.get(name)
    if (!raw) return undefined
    return /^\d{1,10}$/.test(raw) && Number(raw) <= MAX_ID ? Number(raw) : -1
  }
  const clientId = num("clientId")
  const orderId = num("orderId")
  if (clientId === -1 || orderId === -1) return { error: "clientId/orderId: число" }
  return {
    data: {
      tab: tab as "pending" | "accepted" | "cancelled" | "all",
      search: search.get("search")?.trim().slice(0, 200) || undefined,
      warehouse: search.get("warehouse")?.trim().slice(0, 200) || undefined,
      clientId,
      orderId,
      from: from || undefined,
      to: to || undefined,
    },
  }
}
