import { NextResponse } from "next/server"

import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { readBugScreenshot } from "@/lib/bug-reports/repo"
import { withDbErrors } from "@/lib/db-errors"
import { PHOTO_TYPES } from "@/lib/field-activity/photos-repo"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

// GET /api/admin/bug-reports/[id]/screenshot — the stored screenshot of a report, inline (the admin page's
// preview and its enlarged view). Only images whose bytes were checked on upload are stored; the type is
// still limited to those here, with nosniff. Private cache: the bytes of a report never change.
// 404 no report or no screenshot. Admins only (also gated at the edge).
export const GET = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const shot = await readBugScreenshot(id)
  if (!shot) return NextResponse.json({ error: BUG_MESSAGES.notFound }, { status: 404 })
  const type = (PHOTO_TYPES as readonly string[]).includes(shot.type) ? shot.type : "application/octet-stream"
  return new NextResponse(new Uint8Array(shot.data), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(shot.data.length),
      "Content-Disposition": `inline; filename="bug-report-${id}.${EXTENSIONS[type] ?? "bin"}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
