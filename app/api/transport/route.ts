import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { branchExists, createTransport, listTransport } from "@/lib/transport-repo"
import { transportSchema } from "@/lib/transport-schema"
import { parseJsonBody } from "@/lib/validation"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listTransport())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, transportSchema)
  if (parsed.error) return parsed.error
  if (parsed.data.branchId !== null && !(await branchExists(parsed.data.branchId))) {
    return NextResponse.json({ error: "Филиал не найден" }, { status: 400 })
  }

  return NextResponse.json(await createTransport(parsed.data), { status: 201 })
}
