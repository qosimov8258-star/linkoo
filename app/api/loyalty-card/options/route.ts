import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { loyaltyCardOptions } from "@/lib/loyalty-card-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/loyalty-card/options — client types (filter) and currencies (dialog).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await loyaltyCardOptions())
}
