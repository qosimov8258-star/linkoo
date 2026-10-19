import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { searchContractClients } from "@/lib/contracts-repo"

// GET /api/contracts/clients?q&ids=1,2 → [{id, name, zone, inn}] (client picker of the form and the filter).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const search = new URL(request.url).searchParams
  const ids = [...new Set((search.get("ids") ?? "").split(/[-,]/).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500)
  return NextResponse.json(await searchContractClients({ q: (search.get("q") ?? "").slice(0, 200), ids }))
}
