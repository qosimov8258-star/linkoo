import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { contractBodySchema, contractErrorResponse, parseContractListQuery } from "@/lib/contracts-api"
import { createContract, listContracts } from "@/lib/contracts-repo"
import type { ContractStatus } from "@/lib/contracts-types"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/contracts?status&search&ordering&page&pageSize&fromDate&toDate&client*&zone*&agent*&ids → ContractListResult
// (demo GET /sales/contract/?debt=true…). POST → ContractDetail (demo ContractsCreateForm).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseContractListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listContracts(parsed.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, contractBodySchema)
  if (parsed.error) return parsed.error
  try {
    const contract = await createContract({ ...parsed.data, status: parsed.data.status as ContractStatus }, auth.user.displayName || auth.user.username)
    return NextResponse.json(contract, { status: 201 })
  } catch (error) {
    return contractErrorResponse(error)
  }
}
