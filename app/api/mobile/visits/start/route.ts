import { NextResponse } from "next/server"

import { requireFieldActor } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { visitStartSchema } from "@/lib/field-activity/input"
import { startVisit } from "@/lib/field-activity/visits-repo"
import { parseJsonBody } from "@/lib/validation"

// POST /api/mobile/visits/start — the mobile app checks the signed-in employee in at a client.
// Body: {key (8..64 [A-Za-z0-9._:-], the device's idempotency key), clientId, startedAt (ISO
// date-time, zone-less = Tashkent, or epoch ms), lat?, lng?, accuracy? (m), comment?}.
// 201 {visit, created: true}; 200 {visit, created: false} for a retry with the same key;
// 409 visitOpen {openVisit} while another visit of the employee is open; 409 visitKeyTaken for
// the same key with another client. Needs clients.manage (lib/capabilities-catalog.ts) and an
// account linked to an employee (403 noEmployee). Rules: lib/field-activity/input.ts.
export async function POST(request: Request) {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  const parsed = await parseJsonBody(request, visitStartSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () => {
    const { visit, created } = await startVisit(auth.actor, parsed.data)
    return NextResponse.json({ visit, created }, { status: created ? 201 : 200 })
  })
}
