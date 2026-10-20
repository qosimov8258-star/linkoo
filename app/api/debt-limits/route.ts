import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createDebtLimitClient, listDebtLimitClients, type DebtLimitClientInput } from "@/lib/debt-limits-repo"

const debtLimitClientSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  phone: z.string().trim().optional(),
  type: z.string().trim().optional(),
  zoneLabel: z.string().trim().optional(),
  zoneCity: z.string().trim().optional(),
  agent: z.string().trim().optional(),
  courier: z.string().trim().optional(),
  collector: z.string().trim().optional(),
  category: z.enum(["unconfirmed", "problem", "planned-okb", "closure"]).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listDebtLimitClients()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, debtLimitClientSchema)
  if (parsed.error) return parsed.error

  const input: DebtLimitClientInput = {
    name: parsed.data.name,
    phone: parsed.data.phone ?? "",
    type: parsed.data.type ?? "",
    zoneLabel: parsed.data.zoneLabel ?? "",
    zoneCity: parsed.data.zoneCity ?? "",
    agent: parsed.data.agent ?? "",
    courier: parsed.data.courier ?? "",
    collector: parsed.data.collector ?? "",
    category: parsed.data.category ?? "unconfirmed",
  }

  const client = (await createDebtLimitClient(input))
  return NextResponse.json(client, { status: 201 })
}
