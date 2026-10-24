import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteBranch, updateBranch } from "@/lib/branches-repo"

const branchSchema = z.object({
  name: z.string().trim().min(1),
  priceList: z.string().optional(),
  currency: z.string().trim().optional(),
  debtTracking: z.boolean().optional(),
  isMain: z.boolean().optional(),
  locationLat: z.number().finite().nullable().optional(),
  locationLng: z.number().finite().nullable().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, branchSchema)
  if (parsed.error) return parsed.error

  const branch = await updateBranch(id, {
    name: parsed.data.name,
    priceList: parsed.data.priceList ?? "",
    currency: parsed.data.currency ?? "",
    debtTracking: parsed.data.debtTracking ?? true,
    isMain: parsed.data.isMain ?? false,
    locationLat: parsed.data.locationLat ?? null,
    locationLng: parsed.data.locationLng ?? null,
  })
  if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  return NextResponse.json(branch)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteBranch(id))
  if (!ok) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
