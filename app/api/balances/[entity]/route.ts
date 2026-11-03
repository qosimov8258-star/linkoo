import { NextResponse } from "next/server"

import { canReadCompanyMoney } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { forbiddenResponse } from "@/lib/field-activity/actor"
import { parseBalanceKind, parseBalanceListQuery } from "@/lib/finance/api"
import { getBalanceList } from "@/lib/finance/ledger"
import { hasPermission } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/{cashbox|client|account|supplier|vansell|branch|employee}
// → BalanceListResult (rows per entity per currency + totals) for ?from&to…
export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const kind = parseBalanceKind((await params).entity)
  if (!kind) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  // Client balances serve the field staff too; the other balances are company money (lib/company-money.ts).
  const supplierReader = kind === "supplier" && hasPermission(user, "procurement.manage")
  if (kind !== "client" && !supplierReader && !canReadCompanyMoney(user)) return forbiddenResponse()
  const parsed = parseBalanceListQuery(request.url)
  if (parsed.error) return parsed.error

  return NextResponse.json(await getBalanceList(kind, parsed.data))
}
