import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getBillingSummary, getLicenseGroups, getPricing, listLicenseTypes } from "@/lib/subscriptions-repo"

/** Balance card, price list and license pickers of the Подписки page. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const [summary, pricing, groups, licenseTypes] = await Promise.all([getBillingSummary(), getPricing(), getLicenseGroups(), listLicenseTypes()])
  return NextResponse.json({ summary, pricing, groups, licenseTypes })
}
