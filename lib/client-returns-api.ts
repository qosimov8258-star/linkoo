import "server-only"

import { z } from "zod"

import { MAX_MONEY, MAX_QTY } from "@/lib/orders-repo"

// Request schemas of /api/client-returns/** (messages are Russian i18n keys).

const MAX_ID = 2_147_483_647
const id = z.number({ error: "Неверный идентификатор" }).int({ error: "Неверный идентификатор" }).positive({ error: "Неверный идентификатор" }).max(MAX_ID, { error: "Неверный идентификатор" })
const text = (max: number) => z.string({ error: "Неверные данные" }).trim().max(max, { error: "Слишком длинное значение" })

const line = z
  .object({
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
  items: z.array(line).max(500, { error: "Слишком много позиций" }).optional(),
}

export const clientReturnCreateSchema = z
  .object({ ...fields, full: z.boolean().optional(), accept: z.boolean().optional() })
  .refine((value) => value.clientId !== undefined || Boolean(value.client), { error: "Укажите клиента", path: ["client"] })

export const clientReturnUpdateSchema = z.object(fields)

export const clientReturnAcceptSchema = z.object({ ids: z.array(id).min(1, { error: "Выберите возвраты" }).max(500, { error: "Слишком много возвратов" }) })

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
