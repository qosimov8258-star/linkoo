import { getCurrentUser } from "@/lib/current-user"
import { imageResponse } from "@/lib/dictionaries-schema"
import { getTaskPlanPhoto } from "@/lib/tasks-repo"
import { invalidIdResponse, notSignedInResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string; planId: string }> }

// GET /api/tasks/[id]/plans/[planId]/photo — the photo the agent attached to the plan (404 when
// none; ?v= = content version → cached). Any signed-in user.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const segments = await params
  const id = parseIdSegment(segments.id)
  const planId = parseIdSegment(segments.planId)
  if (id === null || planId === null) return invalidIdResponse()
  return imageResponse(await getTaskPlanPhoto(id, planId), new URL(request.url).searchParams.has("v"))
}
