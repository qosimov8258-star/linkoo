import { NextResponse } from "next/server"

import { requirePermission } from "@/lib/rbac"
import { trackingRoute } from "@/lib/tracking-http"
import { locationLockSchema, setLocationLocks } from "@/lib/tracking-location-locks"
import { parseJsonBody } from "@/lib/validation"

// PUT /api/tracking/location-locks {clientIds: number[1..500], locked: boolean} —
// "Изменить блокировку локации" of the selected clients. → {updated} (clients whose flag
// changed). Needs clients.manage; 400 with the first unknown client id.
export async function PUT(request: Request) {
  const auth = await requirePermission("clients.manage")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, locationLockSchema)
  if (parsed.error) return parsed.error
  return trackingRoute(async () => NextResponse.json({ updated: await setLocationLocks(parsed.data, auth.user.id) }))
}
