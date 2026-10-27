import { NextResponse } from "next/server"

import { requireFieldActor } from "@/lib/field-activity/actor"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { fieldRoute, readCappedBytes } from "@/lib/field-activity/http"
import { savePhoto } from "@/lib/field-activity/photos-repo"
import { MAX_PHOTO_BYTES } from "@/lib/field-activity/types"

// POST /api/mobile/photos — uploads one photo of a refusal / photo report (raw body,
// Content-Type image/jpeg | image/png | image/webp, ≤ 1.5 MB; the bytes must be that format).
// 201 {id, url, contentType, size, created: true}; 200 with created: false when the employee
// already uploaded the same bytes. The id is attached by POST /api/mobile/visits/finish.
// Needs clients.manage and an account linked to an employee.
export async function POST(request: Request) {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  return fieldRoute(async () => {
    const bytes = await readCappedBytes(request, MAX_PHOTO_BYTES)
    if (!bytes) throw new FieldError(FIELD_MESSAGES.photoTooLarge, 413, { code: "photoTooLarge" })
    const photo = await savePhoto(auth.actor, bytes, request.headers.get("content-type") ?? "")
    return NextResponse.json(photo, { status: photo.created ? 201 : 200 })
  })
}
