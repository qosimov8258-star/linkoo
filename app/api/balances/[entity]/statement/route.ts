import { NextResponse } from "next/server"

import { canReadCompanyMoney } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { forbiddenResponse } from "@/lib/field-activity/actor"
import { parseBalanceKind, parseStatementQuery } from "@/lib/finance/api"
import { getStatement } from "@/lib/finance/ledger"
import { hasPermission } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/{kind}/statement?key=…&from&to… → StatementResult: the
// entity's movements with running balances (client act, cashbox
// transactions, supplier / van-sell / branch / employee details).
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const kind = parseBalanceKind((await params).entity)
  if (!kind) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  // Client balances serve the field staff too; the other balances are company money (lib/company-money.ts).
  const supplierReader = kind === "supplier" && hasPermission(user, "procurement.manage")
  if (kind !== "client" && !supplierReader && !canReadCompanyMoney(user)) return forbiddenResponse()
  const parsed = parseStatementQuery(request.url)
  if (parsed.error) return parsed.error

  const statement = await getStatement(kind, parsed.data)
  if (!statement) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(statement)
}
