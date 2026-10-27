import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { repricingOptions } from "@/lib/repricings-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/repricings/options — filter / dialog options: {priceLists, users, products}.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await repricingOptions())
}
