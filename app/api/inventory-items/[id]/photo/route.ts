import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryId } from "@/lib/inventory-items-api"
import { getInventoryPhoto } from "@/lib/inventory-items-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/inventory-items/[id]/photo → the item photo (image/*), 404 without one.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseInventoryId((await params).id)
  const photo = id ? await getInventoryPhoto(id) : null
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 })
  return new Response(new Uint8Array(photo.data), { headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=300" } })
}
