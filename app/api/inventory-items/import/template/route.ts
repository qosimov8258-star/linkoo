import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseTemplateQuery } from "@/lib/inventory-items-api"
import { listTemplateClients } from "@/lib/inventory-items-options"

// GET /api/inventory-items/import/template?agent=<name>*&zone=<name>* → InventoryTemplateClient[] (rows of "Скачать шаблон").
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const { agents, zones } = parseTemplateQuery(request.url)
  return NextResponse.json(await listTemplateClients(agents, zones))
}
