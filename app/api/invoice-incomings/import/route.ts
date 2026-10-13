import { NextResponse } from "next/server"

import { invoiceErrorResponse, invoiceImportSchema } from "@/lib/invoice-incomings-api"
import { importInvoices } from "@/lib/invoice-incomings-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

/** Excel import: commit = false → preview with line errors; commit = true → creates when error-free. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, invoiceImportSchema)
  if (parsed.error) return parsed.error
  try {
    const result = await importInvoices(parsed.data.rows, parsed.data.commit, auth.user.displayName)
    return NextResponse.json(result, { status: result.created.length ? 201 : 200 })
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}
