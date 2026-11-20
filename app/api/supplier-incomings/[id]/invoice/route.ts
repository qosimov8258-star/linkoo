import { NextRequest } from "next/server"

import { requireRole } from "@/lib/rbac"
import { incomingChangeResponse, incomingInvoiceSchema, incomingNotFound } from "@/lib/supplier-incomings-api"
import { changeIncomingInvoice } from "@/lib/supplier-incomings-repo"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

/** «Изменить детали счет фактуры» of a supply (any status): number, day (required) and comment; logged as change_invoice. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, incomingInvoiceSchema)
  if (parsed.error) return parsed.error

  const body = { invoiceNumber: parsed.data.invoiceNumber ?? "", invoiceDate: parsed.data.invoiceDate ?? "", invoiceComment: parsed.data.invoiceComment ?? "" }
  return procurementWrite(async () => incomingChangeResponse(await changeIncomingInvoice(id, body, auth.user.displayName), "Действие недоступно для текущего статуса поставки"))
}
