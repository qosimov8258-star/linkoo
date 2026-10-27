import { getBrandImage } from "@/lib/brands-repo"
import { getCurrentUser } from "@/lib/current-user"
import { imageResponse, parseDictionaryId } from "@/lib/dictionaries-schema"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/brands/[id]/image — the brand's picture (?v= = content version → cached).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  return imageResponse(id ? await getBrandImage(id) : null, new URL(request.url).searchParams.has("v"))
}
