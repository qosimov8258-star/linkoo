import "server-only"

import { createHash } from "node:crypto"

import { getDb, type PgDb } from "@/lib/db"
import type { FieldActor } from "@/lib/field-activity/actor"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { fieldPhotoUrl, MAX_PHOTO_BYTES, type FieldPhoto } from "@/lib/field-activity/types"

// Photos of refusals and photo reports. The mobile app uploads each image first
// (POST /api/mobile/photos, raw body), gets its id, and attaches the ids when it finishes the
// visit. Only JPEG / PNG / WebP whose bytes really are that format are stored; the same bytes
// uploaded twice by one employee are one photo (unique employee_id + sha256).

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export type PhotoType = (typeof PHOTO_TYPES)[number]

/** The image format of `bytes` by its magic number, or null. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((value, index) => bytes[index] === value)) return "image/png"
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp"
  return null
}

export type SavedPhoto = { id: number; url: string; contentType: PhotoType; size: number; created: boolean }

/** Stores an uploaded photo of the actor's employee (idempotent by content). */
export async function savePhoto(actor: FieldActor, bytes: Uint8Array, declaredType: string): Promise<SavedPhoto> {
  if (!bytes.length) throw new FieldError(FIELD_MESSAGES.photoEmpty, 400, { code: "photoEmpty" })
  if (bytes.length > MAX_PHOTO_BYTES) throw new FieldError(FIELD_MESSAGES.photoTooLarge, 413, { code: "photoTooLarge" })
  const declared = declaredType.split(";")[0].trim().toLowerCase()
  const detected = sniffPhotoType(bytes)
  if (!detected || !(PHOTO_TYPES as readonly string[]).includes(declared) || declared !== detected) {
    throw new FieldError(FIELD_MESSAGES.photoType, 415, { code: "photoType" })
  }
  await ensureFieldSchema()
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const db = getDb()
  const inserted = (await db
    .prepare(
      `INSERT INTO field_photos (user_id, employee_id, content_type, size_bytes, sha256, data)
       VALUES (@userId, @employeeId, @contentType, @size, @sha256, @data)
       ON CONFLICT (employee_id, sha256) DO NOTHING
       RETURNING id`,
    )
    .get({ userId: actor.user.id, employeeId: actor.employee.id, contentType: detected, size: bytes.length, sha256, data: Buffer.from(bytes) })) as
    | { id: number }
    | undefined
  if (inserted) return { id: Number(inserted.id), url: fieldPhotoUrl(Number(inserted.id)), contentType: detected, size: bytes.length, created: true }
  const existing = (await db.prepare("SELECT id FROM field_photos WHERE employee_id = ? AND sha256 = ?").get(actor.employee.id, sha256)) as { id: number }
  return { id: Number(existing.id), url: fieldPhotoUrl(Number(existing.id)), contentType: detected, size: bytes.length, created: false }
}

/** The stored bytes of a photo (null when it does not exist). */
export async function readPhoto(id: number): Promise<{ data: Buffer; contentType: string; employeeId: number } | null> {
  await ensureFieldSchema()
  const row = (await getDb().prepare("SELECT data, content_type, employee_id FROM field_photos WHERE id = ?").get(id)) as
    | { data: Buffer; content_type: string; employee_id: number }
    | undefined
  return row ? { data: row.data, contentType: row.content_type, employeeId: Number(row.employee_id) } : null
}

/**
 * Attaches the actor's uploaded photos to a refusal / photo report, inside the caller's
 * transaction (rows locked FOR UPDATE). A photo of another employee or a missing one is
 * refused (400), one already attached elsewhere too (409).
 */
export async function attachPhotos(
  tx: PgDb,
  employeeId: number,
  ids: number[],
  owner: { kind: "refusal" | "photo_report"; id: number },
  slot: FieldPhoto["slot"],
  field: string,
): Promise<void> {
  const unique = [...new Set(ids)]
  if (!unique.length) return
  const rows = (await tx
    .prepare("SELECT id, employee_id, owner_kind, owner_id FROM field_photos WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE")
    .all({ ids: unique })) as Array<{ id: number; employee_id: number; owner_kind: string | null; owner_id: number | null }>
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  for (const id of unique) {
    const row = byId.get(id)
    if (!row || Number(row.employee_id) !== employeeId) throw new FieldError(FIELD_MESSAGES.photoNotFound, 400, { field, photoId: id })
    if (row.owner_kind !== null && !(row.owner_kind === owner.kind && Number(row.owner_id) === owner.id)) {
      throw new FieldError(FIELD_MESSAGES.photoTaken, 409, { field, photoId: id })
    }
  }
  for (const [position, id] of unique.entries()) {
    await tx
      .prepare("UPDATE field_photos SET owner_kind = @kind, owner_id = @ownerId, slot = @slot, position = @position WHERE id = @id")
      .run({ kind: owner.kind, ownerId: owner.id, slot, position, id })
  }
}

/** Photos of refusals / photo reports, by owner id, in upload order per slot. */
export async function photosOf(kind: "refusal" | "photo_report", ownerIds: number[], db: PgDb = getDb()): Promise<Map<number, FieldPhoto[]>> {
  const result = new Map<number, FieldPhoto[]>()
  if (!ownerIds.length) return result
  const rows = (await db
    .prepare(
      `SELECT id, owner_id, slot, content_type FROM field_photos
        WHERE owner_kind = @kind AND owner_id = ANY(@ids::int[])
        ORDER BY owner_id, CASE slot WHEN 'refusal' THEN 0 WHEN 'before' THEN 1 ELSE 2 END, position, id`,
    )
    .all({ kind, ids: [...new Set(ownerIds)] })) as Array<{ id: number; owner_id: number; slot: FieldPhoto["slot"]; content_type: string }>
  for (const row of rows) {
    const list = result.get(Number(row.owner_id)) ?? []
    list.push({ id: Number(row.id), url: fieldPhotoUrl(Number(row.id)), slot: row.slot, contentType: row.content_type })
    result.set(Number(row.owner_id), list)
  }
  return result
}
