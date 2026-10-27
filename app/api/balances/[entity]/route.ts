import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseBalanceKind, parseBalanceListQuery } from "@/lib/finance/api"
import { getBalanceList } from "@/lib/finance/ledger"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/{cashbox|client|account|supplier|vansell|branch|employee}
// → BalanceListResult (rows per entity per currency + totals) for ?from&to…
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const kind = parseBalanceKind((await params).entity)
  if (!kind) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const parsed = parseBalanceListQuery(request.url)
  if (parsed.error) return parsed.error

  return NextResponse.json(await getBalanceList(kind, parsed.data))
}
