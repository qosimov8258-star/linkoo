import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSupplier, listSuppliers, parseSupplierInput } from "@/lib/suppliers-repo"

const supplierSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  address: z.string().trim().min(1),
  branch: z.string().optional(),
  organization: z.string().optional(),
  contacts: z.array(z.record(z.string(), z.unknown())).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listSuppliers()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название, категория и адрес обязательны" }, { status: 400 })

  return NextResponse.json((await createSupplier(input)), { status: 201 })
}
