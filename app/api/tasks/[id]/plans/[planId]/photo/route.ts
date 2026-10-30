import { imageResponse } from "@/lib/dictionaries-schema"
import { requireFieldReader } from "@/lib/field-activity/actor"
import { getTaskPlanPhoto } from "@/lib/tasks-repo"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string; planId: string }> }

// GET /api/tasks/[id]/plans/[planId]/photo — the photo the agent attached to the plan (404 when
// none or outside the reader's field scope, lib/field-activity/actor.ts; ?v= = content version → cached).
export async function GET(request: Request, { params }: RouteParams) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const segments = await params
  const id = parseIdSegment(segments.id)
  const planId = parseIdSegment(segments.planId)
  if (id === null || planId === null) return invalidIdResponse()
  return imageResponse(await getTaskPlanPhoto(id, planId, reader.scope), new URL(request.url).searchParams.has("v"))
}
