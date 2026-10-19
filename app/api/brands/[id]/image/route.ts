import { NextResponse } from "next/server"

import { getBrandImage } from "@/lib/brands-repo"
import { getCurrentUser } from "@/lib/current-user"
import { imageResponse, parseDictionaryId } from "@/lib/dictionaries-schema"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/brands/[id]/image — the brand's picture (?v= = content version → cached).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseDictionaryId((await params).id)
  return imageResponse(id ? await getBrandImage(id) : null, new URL(request.url).searchParams.has("v"))
}
