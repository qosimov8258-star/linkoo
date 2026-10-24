import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createBranch, listBranches } from "@/lib/branches-repo"

const branchSchema = z.object({
  name: z.string().trim().min(1),
  priceList: z.string().optional(),
  currency: z.string().trim().optional(),
  debtTracking: z.boolean().optional(),
  isMain: z.boolean().optional(),
  locationLat: z.number().finite().nullable().optional(),
  locationLng: z.number().finite().nullable().optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const byCreation = new URL(request.url).searchParams.get("sort") === "created"
  return NextResponse.json(await listBranches({ byCreation }))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, branchSchema)
  if (parsed.error) return parsed.error

  const branch = await createBranch({
    name: parsed.data.name,
    priceList: parsed.data.priceList ?? "",
    currency: parsed.data.currency ?? "",
    debtTracking: parsed.data.debtTracking ?? true,
    isMain: parsed.data.isMain ?? false,
    locationLat: parsed.data.locationLat ?? null,
    locationLng: parsed.data.locationLng ?? null,
  })
  return NextResponse.json(branch, { status: 201 })
}
