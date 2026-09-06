import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createBrand, listBrands } from "@/lib/brands-repo"

const brandSchema = z.object({
  name: z.string().trim().min(1),
  organization: z.string().trim().min(1),
  photoUrl: z.string().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listBrands()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, brandSchema)
  if (parsed.error) return parsed.error

  const brand = await createBrand({
    name: parsed.data.name,
    organization: parsed.data.organization,
    photoUrl: parsed.data.photoUrl && parsed.data.photoUrl.trim() ? parsed.data.photoUrl : null,
  })
  return NextResponse.json(brand, { status: 201 })
}
