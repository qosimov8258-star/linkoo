import { NextResponse } from "next/server"

import { branchErrorResponse, branchSchema } from "@/app/api/branches/schema"
import { parseBody } from "@/lib/auth-request"
import { createBranch, listBranches } from "@/lib/branches-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listBranches())
}

// POST /api/branches — 409 for a name that exists (case- and space-insensitive);
// isMain: true makes it the only main branch.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, branchSchema)
  if (parsed.error) return parsed.error

  try {
    const branch = await createBranch({
      name: parsed.data.name,
      priceList: parsed.data.priceList ?? "",
      currency: parsed.data.currency,
      debtTracking: parsed.data.debtTracking ?? true,
      isMain: parsed.data.isMain ?? false,
    })
    return NextResponse.json(branch, { status: 201 })
  } catch (error) {
    const response = branchErrorResponse(error)
    if (response) return response
    throw error
  }
}
