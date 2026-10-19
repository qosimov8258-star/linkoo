import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { parseItemKey } from "@/lib/production-schema"

export type RouteParams = { params: Promise<{ id: string }> }

export async function routeId({ params }: RouteParams): Promise<number | null> {
  const id = Number((await params).id)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function requireViewer() {
  const user = await getCurrentUser()
  return user ? null : NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export const notFound = (message = "Запись не найдена") => errorResponse(message, 404)

export function positiveIntParam(value: string | null): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const amount = z.coerce.number().finite().positive()

/** "product:12" / "raw_material:5" catalog key, validated and split. */
export const itemKeySchema = z
  .string()
  .transform((value, context) => {
    const parsed = parseItemKey(value)
    if (!parsed) {
      context.addIssue({ code: "custom", message: "Неверный товар" })
      return z.NEVER
    }
    return parsed
  })

export const itemLinesSchema = z.array(z.object({ key: itemKeySchema, amount })).min(1)

export const schemas = {
  stage: z.object({
    name: z.string().trim().min(1),
    warehouse: z.string().trim().default(""),
    responsible: z.string().trim().default(""),
  }),
  equipment: z.object({
    stageId: z.coerce.number().int().positive(),
    name: z.string().trim().min(1),
    status: z.enum(["0", "1"]).default("0"),
    image: z.string().max(3_000_000).default(""),
  }),
  operation: z.object({
    stageId: z.coerce.number().int().positive(),
    title: z.string().trim().min(1),
    duration: z.coerce.number().int().min(0).default(0),
    type: z.enum(["equipment", "human"]),
    equipmentId: z.coerce.number().int().positive().nullable().default(null),
  }),
  staff: z.object({
    stageId: z.coerce.number().int().positive(),
    employeeId: z.coerce.number().int().positive().nullable().default(null),
    employeeName: z.string().trim().min(1),
    position: z.string().trim().default(""),
    shift: z.string().trim().default(""),
    beginTime: z.string().trim().default(""),
    endTime: z.string().trim().default(""),
  }),
  recipe: z.object({
    stageId: z.coerce.number().int().positive(),
    key: itemKeySchema,
    equipmentId: z.coerce.number().int().positive().nullable().default(null),
    amount,
    components: z.array(z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount })).default([]),
  }),
  recipeUpdate: z.object({
    equipmentId: z.coerce.number().int().positive().nullable().default(null),
    amount,
  }),
  recipeComponent: z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount }),
  componentAmount: z.object({ amount }),
  party: z.object({
    stageId: z.coerce.number().int().positive(),
    date: dateString,
    comment: z.string().trim().default(""),
  }),
  partyUpdate: z.object({
    stageId: z.coerce.number().int().positive(),
    status: z.enum(["pending", "finished", "cancelled"]),
    date: dateString,
    comment: z.string().trim().default(""),
  }),
  partyItems: z.object({
    direction: z.enum(["made", "raw"]),
    date: dateString.optional(),
    items: itemLinesSchema,
  }),
  defect: z.object({
    type: z.enum(["made", "raw"]),
    key: itemKeySchema,
    amount,
    comment: z.string().trim().default(""),
    image: z.string().max(3_000_000).default(""),
  }),
  autoFinish: z.object({
    recipeId: z.coerce.number().int().positive(),
    amount,
    comment: z.string().trim().default(""),
    components: z.array(z.object({ key: itemKeySchema, amount })).default([]),
  }),
  activity: z.object({
    stageId: z.coerce.number().int().positive(),
    direction: z.enum(["made", "raw"]),
    date: dateString,
    shift: z.string().trim().default(""),
    equipmentId: z.coerce.number().int().positive().nullable().default(null),
    worker: z.string().trim().default(""),
    items: z.array(z.object({ key: itemKeySchema, amount, isDefect: z.boolean().default(false) })).min(1),
  }),
  inventory: z.object({
    stageId: z.coerce.number().int().positive(),
    date: dateString,
    comment: z.string().trim().default(""),
    lines: z.array(z.object({ key: z.string(), actual: z.coerce.number().finite().min(0) })).min(1),
  }),
}

/** Shared response for the batch movement endpoints (add made / raw / defect,
 * auto-finish), which all return the refreshed batch detail. */
export function movementResponse(result: object | "not_found" | "not_pending" | "empty") {
  if (result === "not_found") return notFound("Партия не найдена")
  if (result === "not_pending") return errorResponse("Партия уже завершена", 409)
  if (result === "empty") return errorResponse("Добавьте хотя бы один товар")
  return NextResponse.json(result)
}

export function isDateParam(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
