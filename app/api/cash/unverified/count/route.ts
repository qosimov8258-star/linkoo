import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { countUnverifiedOperations } from "@/lib/cash/list"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/unverified/count → { count } (clock badge, polled every 5 s).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json({ count: await countUnverifiedOperations() })
}
