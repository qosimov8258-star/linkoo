import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createBranch, listBranches } from "@/lib/branches-repo"

const branchSchema = z.object({
  name: z.string().trim().min(1),
  priceList: z.string().optional(),
  currency: z.enum(["SUM", "USD", "Euro"]).optional(),
  debtTracking: z.boolean().optional(),
  isMain: z.boolean().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listBranches()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, branchSchema)
  if (parsed.error) return parsed.error

  const branch = await createBranch({
    name: parsed.data.name,
    priceList: parsed.data.priceList ?? "",
    currency: parsed.data.currency ?? "SUM",
    debtTracking: parsed.data.debtTracking ?? true,
    isMain: parsed.data.isMain ?? false,
  })
  return NextResponse.json(branch, { status: 201 })
}
