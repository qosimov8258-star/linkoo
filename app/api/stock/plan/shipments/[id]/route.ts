import { NextResponse } from "next/server"
import { z } from "zod"

import { withDbErrors } from "@/lib/db-errors"
import { isIsoDay } from "@/lib/finance/dates"
import { transferResponse } from "@/lib/internal-transfers-api"
import { transferAction } from "@/lib/internal-transfers-repo"
import { sessionTransferId } from "@/lib/production-sessions-repo"
import { requirePermission } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"

// POST /api/stock/plan/shipments/[id] {action, date?} — an «Отгрузка» (the hand-over of production shift session
// №id, «Передать на склад») in Склад → План приемок и передач, as Linko's manufacture/shipment/<id>/done/ {date} and
// …/cancel/: "accept" takes the goods into the target warehouse on `date` (default today; Приемка), "cancel_accepted"
// takes them out again while the target still holds them on every day (История Приемки → back to Приемка). The
// warehouse keeper works the plan with the stock permission (the /api/stock/** rule of lib/capabilities-catalog.ts).
const schema = z.object({
  action: z.enum(["accept", "cancel_accepted"], { error: "Неизвестное действие" }),
  date: z
    .string({ error: "Неверная дата" })
    .optional()
    .refine((value) => !value || isIsoDay(value), "Неверная дата"),
})

export const POST = withDbErrors(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("stock.manage")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const transferId = await sessionTransferId(id)
  if (!transferId) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 })
  return transferResponse(await transferAction(transferId, parsed.data.action, { date: parsed.data.date }, auth.user.displayName))
})
