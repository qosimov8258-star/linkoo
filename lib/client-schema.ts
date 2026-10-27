import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { nameField, textField } from "@/lib/auth-request"
import { ClientZoneError, type ClientZoneInput } from "@/lib/client-zones-repo"
import { ClientError, type ClientInput } from "@/lib/clients-repo"

// Request schema of POST /api/clients and PUT /api/clients/[id] (messages are Russian i18n keys).

const text = (max: number) => z.string({ error: "Неверные данные" }).trim().max(max, { error: "Слишком длинное значение" })
const required = (message: string, max = 300) =>
  z.string({ error: message }).trim().min(1, { error: message }).max(max, { error: "Слишком длинное значение" })

export const clientSchema = z.object({
  name: required("Укажите название клиента"),
  phone: required("Укажите телефон", 200),
  type: required("Укажите тип клиента", 200),
  zone: required("Укажите зону", 200),
  inn: text(50)
    .refine((value) => !value || /^\d+$/.test(value.replace(/\s/g, "")), { error: "ИНН должен содержать только цифры" })
    .optional(),
  zoneAgent: text(200).optional(),
  agent: text(200).optional(),
  deliverer: text(200).optional(),
  collector: text(200).optional(),
  /** Opening balance; omitted on update = keep, null = clear. */
  balance: z
    .number({ error: "Баланс должен быть числом" })
    .finite({ error: "Баланс должен быть числом" })
    .min(-1e13, { error: "Баланс слишком большой" })
    .max(1e13, { error: "Баланс слишком большой" })
    .nullable()
    .optional(),
  tab: z.enum(["unconfirmed", "problem", "plan", "closing", "all"]).optional(),
  branch: text(200).optional(),
  salesChannel: text(200).optional(),
  realizationBy: text(200).optional(),
  address: text(500).optional(),
  landmark: text(500).optional(),
  locationLat: z.number().finite().min(-90, { error: "Широта должна быть от -90 до 90" }).max(90, { error: "Широта должна быть от -90 до 90" }).optional(),
  locationLng: z.number().finite().min(-180, { error: "Долгота должна быть от -180 до 180" }).max(180, { error: "Долгота должна быть от -180 до 180" }).optional(),
  telegramLocationLink: text(1000).optional(),
  code: text(100).optional(),
  contactPerson: text(200).optional(),
  note: text(2000).optional(),
  autoDelivery: z.boolean().optional(),
  unlimitedDebt: z.boolean().optional(),
  attributes: z.record(z.string(), z.string().max(1000)).optional(),
  allowDuplicate: z.boolean().optional(),
})

export type ClientBody = z.infer<typeof clientSchema>

export function clientInputOf(body: ClientBody): ClientInput {
  return {
    name: body.name,
    phone: body.phone,
    type: body.type,
    zone: body.zone,
    inn: body.inn || undefined,
    zoneAgent: body.zoneAgent || "Не указано",
    agent: body.agent || "Не указано",
    deliverer: body.deliverer || "Не указано",
    collector: body.collector || "Не указано",
    balance: body.balance,
    tab: body.tab ?? "all",
    branch: body.branch,
    salesChannel: body.salesChannel,
    realizationBy: body.realizationBy,
    address: body.address,
    landmark: body.landmark,
    locationLat: body.locationLat,
    locationLng: body.locationLng,
    telegramLocationLink: body.telegramLocationLink,
    code: body.code,
    contactPerson: body.contactPerson,
    note: body.note,
    autoDelivery: body.autoDelivery,
    unlimitedDebt: body.unlimitedDebt,
    attributes: body.attributes,
    allowDuplicate: body.allowDuplicate,
  }
}

export function clientErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientError) return NextResponse.json({ error: error.message, ...(error.extra ?? {}) }, { status: error.status })
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}

// Request schema of POST /api/clients/zones and PUT /api/clients/zones/[id].

const latitude = z
  .number({ error: "Неверные координаты" })
  .finite({ error: "Неверные координаты" })
  .min(-90, { error: "Широта должна быть от -90 до 90" })
  .max(90, { error: "Широта должна быть от -90 до 90" })
const longitude = z
  .number({ error: "Неверные координаты" })
  .finite({ error: "Неверные координаты" })
  .min(-180, { error: "Долгота должна быть от -180 до 180" })
  .max(180, { error: "Долгота должна быть от -180 до 180" })

export const clientZoneSchema = z.object({
  name: nameField("Укажите название зоны", 200),
  branch: textField(200).optional(),
  parentId: z
    .number({ error: "Родительская зона не найдена" })
    .int({ error: "Родительская зона не найдена" })
    .positive({ error: "Родительская зона не найдена" })
    .max(2_147_483_647, { error: "Родительская зона не найдена" })
    .nullable()
    .optional(),
  polygon: z
    .array(z.tuple([latitude, longitude], { error: "Неверные координаты" }), { error: "Неверные координаты" })
    .max(1000, { error: "Слишком много точек в контуре зоны" })
    .refine((ring) => ring.length === 0 || ring.length >= 3, { error: "Контур зоны должен содержать не менее 3 точек" })
    .nullable()
    .optional(),
  reassignClients: z.boolean({ error: "Неверные данные" }).optional(),
})

export function clientZoneInputOf(body: z.infer<typeof clientZoneSchema>): ClientZoneInput {
  return {
    name: body.name,
    branch: body.branch,
    parentId: body.parentId,
    polygon: body.polygon,
    reassignClients: body.reassignClients,
  }
}

export function clientZoneErrorResponse(error: unknown): NextResponse {
  if (error instanceof ClientZoneError) return NextResponse.json({ error: error.message, ...(error.extra ?? {}) }, { status: error.status })
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}
