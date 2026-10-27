import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { contractBodySchema, contractErrorResponse, contractStatusSchema, parseIdParam } from "@/lib/contracts-api"
import { deleteContract, getContract, setContractStatus, updateContract } from "@/lib/contracts-repo"
import { normalizeContractStatus, type ContractStatus } from "@/lib/contracts-types"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET → ContractDetail (with the payments made under the contract and totals per currency).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseIdParam((await params).id)
  const contract = id ? await getContract(id) : null
  if (!contract) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  return NextResponse.json(contract)
}

// PUT → full update (same body as POST /api/contracts).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  if (!id) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, contractBodySchema)
  if (parsed.error) return parsed.error
  try {
    const contract = await updateContract(id, { ...parsed.data, status: parsed.data.status as ContractStatus })
    if (!contract) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
    return NextResponse.json(contract)
  } catch (error) {
    return contractErrorResponse(error)
  }
}

// PATCH {status} → complete / cancel / reactivate.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  if (!id) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, contractStatusSchema)
  if (parsed.error) return parsed.error
  const status = normalizeContractStatus(parsed.data.status)
  if (!status) return NextResponse.json({ error: "Укажите статус", field: "status" }, { status: 400 })
  const contract = await setContractStatus(id, status)
  if (!contract) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  return NextResponse.json(contract)
}

// DELETE → 409 while payments reference the contract.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  try {
    const ok = id ? await deleteContract(id) : false
    if (!ok) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return contractErrorResponse(error)
  }
}
