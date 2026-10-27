import { NextResponse } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { readPhoto } from "@/lib/field-activity/photos-repo"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/field-activity/photos/[id] — the image of a refusal / photo report. A reader restricted
// to their own data gets 404 for another employee's photo.
export async function GET(_request: Request, { params }: RouteParams) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  return fieldRoute(async () => {
    const photo = await readPhoto(id)
    if (!photo || !scopeAllows(reader.scope, photo.employeeId)) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
    return new Response(new Uint8Array(photo.data), {
      headers: {
        "Content-Type": photo.contentType,
        "Content-Length": String(photo.data.length),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    })
  })
}
