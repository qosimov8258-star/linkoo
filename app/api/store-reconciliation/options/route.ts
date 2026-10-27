import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStoreReconciliationOptions } from "@/lib/finance-store-reconciliation"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/store-reconciliation/options — filter / dialog lookups (branches,
// organizations, zones, client types, agents, deliverers, users, currencies).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getStoreReconciliationOptions())
}
