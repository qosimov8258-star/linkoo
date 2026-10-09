import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseJsonBody } from "@/lib/validation"
import { groupPaymentMatchSchema } from "@/lib/cash/api"
import { matchGroupPaymentRows } from "@/lib/cash/group-payment"

// POST /api/cash/group-payment/match  { rows: [{client?, inn?, code?, amount, organization?, date?, comment?}] }
// → { founds, notFounds } ("Импортировать c Excel"; the file is parsed in the browser).
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = await parseJsonBody(request, groupPaymentMatchSchema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await matchGroupPaymentRows(parsed.data.rows))
}
