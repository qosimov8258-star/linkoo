import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { imageResponse, parseDictionaryId } from "@/lib/dictionaries-schema"
import { getProductTypeImage } from "@/lib/product-types-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/product-types/[id]/image — the type's picture (?v= = content version → cached).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseDictionaryId((await params).id)
  return imageResponse(id ? await getProductTypeImage(id) : null, new URL(request.url).searchParams.has("v"))
}
