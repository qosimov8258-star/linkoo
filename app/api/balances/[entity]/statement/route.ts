import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseBalanceKind, parseStatementQuery } from "@/lib/finance/api"
import { getStatement } from "@/lib/finance/ledger"

// GET /api/balances/{kind}/statement?key=…&from&to… → StatementResult: the
// entity's movements with running balances (client act, cashbox
// transactions, supplier / van-sell / branch / employee details).
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const kind = parseBalanceKind((await params).entity)
  if (!kind) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const parsed = parseStatementQuery(request.url)
  if (parsed.error) return parsed.error

  const statement = await getStatement(kind, parsed.data)
  if (!statement) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(statement)
}
