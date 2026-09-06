import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createLinkedRepricing, listLinkedRepricings } from "@/lib/linked-repricings-repo"

const linkedRepricingSchema = z.object({
  priceListId: z.number().finite(),
  priceListName: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listLinkedRepricings()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const user = auth.user

  const parsed = await parseJsonBody(request, linkedRepricingSchema)
  if (parsed.error) return parsed.error

  const linkedRepricing = (await createLinkedRepricing(
    { priceListId: parsed.data.priceListId, priceListName: parsed.data.priceListName ?? "" },
    user.displayName,
  ))
  return NextResponse.json(linkedRepricing, { status: 201 })
}
