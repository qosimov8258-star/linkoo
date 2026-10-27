import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { createSupplier, listSuppliers, parseSupplierInput, supplierSchema } from "@/lib/suppliers-repo"
import { parseProcurementBody, procurementWrite } from "@/lib/supplier-refs"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSuppliers()))
}

/** 409 for a duplicate name (fin_key); 400 for an unknown category / branch / organization. */
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseProcurementBody(request, supplierSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название, категория и адрес обязательны" }, { status: 400 })

  return procurementWrite(async () => NextResponse.json(await createSupplier(input), { status: 201 }))
}
