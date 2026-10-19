import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createContract, listContracts } from "@/lib/contracts-repo"

const contractSchema = z.object({
  client: z.string().trim().optional(),
  agent: z.string().trim().optional(),
  zone: z.string().trim().optional(),
  inn: z.string().trim().optional(),
  organization: z.string().trim().optional(),
  comment: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listContracts()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, contractSchema)
  if (parsed.error) return parsed.error

  const contract = await createContract({
    client: parsed.data.client || "Не указан",
    agent: parsed.data.agent || "Admin Ritm",
    zone: parsed.data.zone || "Не указан",
    inn: parsed.data.inn || "0",
    organization: parsed.data.organization || "Не указано",
    comment: parsed.data.comment || "Не указано",
  })
  return NextResponse.json(contract, { status: 201 })
}
