import { NextResponse } from "next/server"

import { requireFieldActor } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { visitFinishSchema } from "@/lib/field-activity/input"
import { finishVisit } from "@/lib/field-activity/visits-repo"
import { parseJsonBody } from "@/lib/validation"

// POST /api/mobile/visits/finish — the mobile app checks the employee out of a visit.
// Body: {key | visitId, finishedAt, lat?, lng?, accuracy?, result: order | refusal |
// photo_report | no_sale, orderId? (result order: an order of the same client), comment?,
// refusal? {refusalTypeId?, comment?, photoIds? ≤ 5} (required for result refusal),
// report? {comment?, beforePhotoIds? ≤ 10, afterPhotoIds? ≤ 10} (with any result; required for
// photo_report)}. Photos are uploaded first (POST /api/mobile/photos).
// 200 {visit, finished: true}; {finished: false} for an identical retry; 404 visitNotFound;
// 409 visitFinished. Needs clients.manage and an account linked to an employee.
export async function POST(request: Request) {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  const parsed = await parseJsonBody(request, visitFinishSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () => NextResponse.json(await finishVisit(auth.actor, parsed.data)))
}
