import { NextResponse } from "next/server"

import { contractImportSchema } from "@/lib/contracts-api"
import { importContracts } from "@/lib/contracts-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/contracts/import {rows} → ContractImportResult ("Импортировать с excel"; clients / agent /
// organization are matched by name, each row is created like POST /api/contracts).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, contractImportSchema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await importContracts(parsed.data.rows, auth.user.displayName || auth.user.username))
}
