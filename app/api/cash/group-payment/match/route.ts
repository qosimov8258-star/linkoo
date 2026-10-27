import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { groupPaymentMatchSchema } from "@/lib/cash/api"
import { matchGroupPaymentRows } from "@/lib/cash/group-payment"

// POST /api/cash/group-payment/match  { rows: [{client?, inn?, code?, amount, organization?, date?, comment?}] }
// → { founds, notFounds } ("Импортировать c Excel"; the file is parsed in the browser).
export async function POST(request: Request) {
  // Read-only matching, but under /api/cash: the route checks cash.manage itself.
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, groupPaymentMatchSchema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await matchGroupPaymentRows(parsed.data.rows))
}
