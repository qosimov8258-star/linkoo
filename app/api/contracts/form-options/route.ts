import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getContractFormOptions } from "@/lib/contracts-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/contracts/form-options → ContractFormOptions (agents, organizations, zones, agent names).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getContractFormOptions())
}
