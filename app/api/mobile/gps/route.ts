import { NextResponse } from "next/server"

import { requireFieldActor } from "@/lib/field-activity/actor"
import { insertGpsPoints } from "@/lib/field-activity/gps-repo"
import { fieldRoute } from "@/lib/field-activity/http"
import { gpsBatchSchema } from "@/lib/field-activity/input"
import { parseJsonBody } from "@/lib/validation"

// POST /api/mobile/gps — the tracker of the mobile app sends the signed-in employee's points.
// Body: {points: [{recordedAt (ISO date-time or epoch ms), lat, lng, accuracy? (m), speed?
// (m/s, 0..200), battery? (%, 0..100)}] (1..1000)}. Idempotent: a point of the same employee and
// instant is stored once. 200 {accepted, duplicates}.
// Self-service like the work check-ins (/api/mobile/check-ins): the track belongs to the caller's
// own employee, so no access-right permission is needed (a collector or a driver restricted to
// the cash desk or the stock is still tracked) — only a signed-in, non-viewer account (viewers
// are refused at the edge) linked to an active employee (403 noEmployee).
export async function POST(request: Request) {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  const parsed = await parseJsonBody(request, gpsBatchSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () => NextResponse.json(await insertGpsPoints(auth.actor, parsed.data)))
}
