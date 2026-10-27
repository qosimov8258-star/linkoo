import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { FieldActor } from "@/lib/field-activity/actor"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { haversineMeters, localDay, localIso, type VisitFinishInput, type VisitStartInput } from "@/lib/field-activity/input"
import { attachPhotos } from "@/lib/field-activity/photos-repo"
import { isPlanned } from "@/lib/field-activity/routes-repo"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { MAX_VISIT_MS, type VisitResult } from "@/lib/field-activity/types"
import { getRefusalType } from "@/lib/refusal-types-repo"

// Visits (check-in / check-out at a client) sent by the mobile app of the signed-in employee.
// Start: idempotent by the device key; at most one open visit per employee (advisory lock per
// employee + partial unique index). Finish: the visit row is locked FOR UPDATE and re-checked;
// a refusal / photo report and their photos are written in the same transaction.

export type FieldVisit = {
  id: number
  key: string
  employeeId: number
  clientId: number
  clientName: string
  startedAt: string
  finishedAt: string | null
  durationSec: number | null
  result: VisitResult | null
  orderId: number | null
  planned: boolean
  distanceM: number | null
  startLat: number | null
  startLng: number | null
  startAccuracy: number | null
  endLat: number | null
  endLng: number | null
  endAccuracy: number | null
  clientLat: number | null
  clientLng: number | null
  comment: string
  refusalId: number | null
  reportId: number | null
}

type VisitRow = {
  id: number
  client_key: string
  employee_id: number
  client_id: number
  client_name: string | null
  started_at: Date
  finished_at: Date | null
  result: VisitResult | null
  order_id: number | null
  planned: boolean
  distance_m: number | null
  start_lat: number | null
  start_lng: number | null
  start_accuracy: number | null
  end_lat: number | null
  end_lng: number | null
  end_accuracy: number | null
  client_lat: number | null
  client_lng: number | null
  comment: string
  refusal_id: number | null
  report_id: number | null
}

const num = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value))

function rowToVisit(row: VisitRow): FieldVisit {
  const started = new Date(row.started_at).getTime()
  const finished = row.finished_at ? new Date(row.finished_at).getTime() : null
  return {
    id: Number(row.id),
    key: row.client_key,
    employeeId: Number(row.employee_id),
    clientId: Number(row.client_id),
    clientName: row.client_name ?? "",
    startedAt: localIso(started),
    finishedAt: finished === null ? null : localIso(finished),
    durationSec: finished === null ? null : Math.round((finished - started) / 1000),
    result: row.result,
    orderId: num(row.order_id),
    planned: Boolean(row.planned),
    distanceM: num(row.distance_m),
    startLat: num(row.start_lat),
    startLng: num(row.start_lng),
    startAccuracy: num(row.start_accuracy),
    endLat: num(row.end_lat),
    endLng: num(row.end_lng),
    endAccuracy: num(row.end_accuracy),
    clientLat: num(row.client_lat),
    clientLng: num(row.client_lng),
    comment: row.comment ?? "",
    refusalId: num(row.refusal_id),
    reportId: num(row.report_id),
  }
}

const VISIT_SELECT = `SELECT v.*, c.name AS client_name, fr.id AS refusal_id, fp.id AS report_id
  FROM field_visits v
  LEFT JOIN clients c ON c.id = v.client_id
  LEFT JOIN field_refusals fr ON fr.visit_id = v.id
  LEFT JOIN field_photo_reports fp ON fp.visit_id = v.id`

/** One visit by id (null when missing). */
export async function getVisit(id: number, db: PgDb = getDb()): Promise<FieldVisit | null> {
  await ensureFieldSchema()
  const row = (await db.prepare(`${VISIT_SELECT} WHERE v.id = ?`).get(id)) as VisitRow | undefined
  return row ? rowToVisit(row) : null
}

/** The employee's open visit, if any. */
export async function openVisitOf(employeeId: number): Promise<FieldVisit | null> {
  await ensureFieldSchema()
  const row = (await getDb().prepare(`${VISIT_SELECT} WHERE v.employee_id = ? AND v.finished_at IS NULL`).get(employeeId)) as VisitRow | undefined
  return row ? rowToVisit(row) : null
}

function hasPosition(input: { lat?: number | null; lng?: number | null }): input is { lat: number; lng: number } {
  return input.lat !== undefined && input.lat !== null && input.lng !== undefined && input.lng !== null
}

async function lockEmployee(tx: PgDb, employeeId: number) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:field:employee:' || @employeeId::text))").get({ employeeId })
}

/** Starts a visit (201) or returns the one already started with this key (created: false). */
export async function startVisit(actor: FieldActor, input: VisitStartInput): Promise<{ visit: FieldVisit; created: boolean }> {
  await ensureFieldSchema()
  const employeeId = actor.employee.id
  if (actor.employee.gpsCheck && !hasPosition(input)) throw new FieldError(FIELD_MESSAGES.coordinatesRequired, 400, { field: "lat", code: "coordinatesRequired" })
  const outcome = await withTransaction(async (tx) => {
    await lockEmployee(tx, employeeId)
    const existing = (await tx
      .prepare("SELECT id, client_id FROM field_visits WHERE employee_id = @employeeId AND client_key = @key")
      .get({ employeeId, key: input.key })) as { id: number; client_id: number } | undefined
    if (existing) {
      if (Number(existing.client_id) !== input.clientId) throw new FieldError(FIELD_MESSAGES.visitKeyTaken, 409, { field: "key", code: "visitKeyTaken" })
      return { id: Number(existing.id), created: false }
    }
    const open = (await tx.prepare(`${VISIT_SELECT} WHERE v.employee_id = ? AND v.finished_at IS NULL`).get(employeeId)) as VisitRow | undefined
    if (open) throw new FieldError(FIELD_MESSAGES.visitOpen, 409, { code: "visitOpen", openVisit: rowToVisit(open) })
    const client = (await tx.prepare("SELECT id, location_lat, location_lng FROM clients WHERE id = ? FOR SHARE").get(input.clientId)) as
      | { id: number; location_lat: number | null; location_lng: number | null }
      | undefined
    if (!client) throw new FieldError(FIELD_MESSAGES.clientNotFound, 400, { field: "clientId" })
    const clientLat = num(client.location_lat)
    const clientLng = num(client.location_lng)
    const distance =
      hasPosition(input) && clientLat !== null && clientLng !== null ? Math.round(haversineMeters(clientLat, clientLng, input.lat, input.lng) * 10) / 10 : null
    const planned = await isPlanned(tx, employeeId, input.clientId, localDay(input.startedAt))
    const row = (await tx
      .prepare(
        `INSERT INTO field_visits (client_key, user_id, employee_id, client_id, started_at, start_lat, start_lng, start_accuracy,
           comment, planned, client_lat, client_lng, distance_m)
         VALUES (@key, @userId, @employeeId, @clientId, @startedAt::timestamptz, @lat, @lng, @accuracy,
           @comment, @planned, @clientLat, @clientLng, @distance)
         RETURNING id`,
      )
      .get({
        key: input.key,
        userId: actor.user.id,
        employeeId,
        clientId: input.clientId,
        startedAt: new Date(input.startedAt).toISOString(),
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracy: input.accuracy ?? null,
        comment: input.comment ?? "",
        planned,
        clientLat,
        clientLng,
        distance,
      })) as { id: number }
    return { id: Number(row.id), created: true }
  })
  return { visit: (await getVisit(outcome.id))!, created: outcome.created }
}

/** Finishes the employee's visit (by key or id) with its result; returns the visit and whether
 * this call finished it (false: an identical retry of an already finished visit). */
export async function finishVisit(actor: FieldActor, input: VisitFinishInput): Promise<{ visit: FieldVisit; finished: boolean }> {
  await ensureFieldSchema()
  const employeeId = actor.employee.id
  if (actor.employee.gpsCheck && !hasPosition(input)) throw new FieldError(FIELD_MESSAGES.coordinatesRequired, 400, { field: "lat", code: "coordinatesRequired" })
  // Also creates the refusal_types table on a fresh database before the transaction reads it.
  const refusalTypeId = input.refusal?.refusalTypeId ?? null
  if (refusalTypeId && !(await getRefusalType(refusalTypeId))) {
    throw new FieldError(FIELD_MESSAGES.refusalTypeNotFound, 400, { field: "refusal.refusalTypeId" })
  }
  const outcome = await withTransaction(async (tx) => {
    const visit = (await tx
      .prepare(
        input.visitId !== undefined
          ? "SELECT * FROM field_visits WHERE employee_id = @employeeId AND id = @visitId FOR UPDATE"
          : "SELECT * FROM field_visits WHERE employee_id = @employeeId AND client_key = @key FOR UPDATE",
      )
      .get({ employeeId, visitId: input.visitId ?? 0, key: input.key ?? "" })) as VisitRow | undefined
    if (!visit) throw new FieldError(FIELD_MESSAGES.visitNotFound, 404, { field: input.visitId !== undefined ? "visitId" : "key", code: "visitNotFound" })
    if (visit.finished_at) {
      const same = visit.result === input.result && Math.abs(new Date(visit.finished_at).getTime() - input.finishedAt) < 1000
      if (same) return { id: Number(visit.id), finished: false }
      throw new FieldError(FIELD_MESSAGES.visitFinished, 409, { code: "visitFinished" })
    }
    const started = new Date(visit.started_at).getTime()
    if (input.finishedAt < started) throw new FieldError(FIELD_MESSAGES.finishBeforeStart, 400, { field: "finishedAt" })
    if (input.finishedAt - started > MAX_VISIT_MS) throw new FieldError(FIELD_MESSAGES.visitTooLong, 400, { field: "finishedAt" })
    const clientId = Number(visit.client_id)
    if (input.orderId) {
      const order = (await tx.prepare("SELECT id, client_id FROM orders WHERE id = ?").get(input.orderId)) as { id: number; client_id: number | null } | undefined
      if (!order) throw new FieldError(FIELD_MESSAGES.orderNotFound, 400, { field: "orderId" })
      if (order.client_id === null || Number(order.client_id) !== clientId) throw new FieldError(FIELD_MESSAGES.orderOfOtherClient, 400, { field: "orderId" })
    }
    const finishedAt = new Date(input.finishedAt).toISOString()
    await tx
      .prepare(
        `UPDATE field_visits SET finished_at = @finishedAt::timestamptz, end_lat = @lat, end_lng = @lng, end_accuracy = @accuracy,
           result = @result, order_id = @orderId, comment = CASE WHEN @comment::text <> '' THEN @comment::text ELSE comment END, updated_at = now()
         WHERE id = @id`,
      )
      .run({
        id: visit.id,
        finishedAt,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracy: input.accuracy ?? null,
        result: input.result,
        orderId: input.orderId ?? null,
        comment: input.comment ?? "",
      })
    // The event's position: where the visit was closed, else where it started.
    const lat = hasPosition(input) ? input.lat : num(visit.start_lat)
    const lng = hasPosition(input) ? input.lng : num(visit.start_lng)
    const common = { visitId: visit.id, userId: actor.user.id, employeeId, clientId, lat, lng, at: finishedAt }
    if (input.result === "refusal" && input.refusal) {
      let reason = ""
      if (refusalTypeId) {
        const type = (await tx.prepare("SELECT name FROM refusal_types WHERE id = ? FOR SHARE").get(refusalTypeId)) as { name: string } | undefined
        if (!type) throw new FieldError(FIELD_MESSAGES.refusalTypeNotFound, 400, { field: "refusal.refusalTypeId" })
        reason = type.name
      }
      const refusal = (await tx
        .prepare(
          `INSERT INTO field_refusals (visit_id, user_id, employee_id, client_id, refusal_type_id, reason, comment, lat, lng, happened_at)
           VALUES (@visitId, @userId, @employeeId, @clientId, @typeId, @reason, @comment, @lat, @lng, @at::timestamptz) RETURNING id`,
        )
        .get({ ...common, typeId: refusalTypeId, reason, comment: input.refusal.comment ?? "" })) as { id: number }
      await attachPhotos(tx, employeeId, input.refusal.photoIds ?? [], { kind: "refusal", id: Number(refusal.id) }, "refusal", "refusal.photoIds")
    }
    if (input.report) {
      const report = (await tx
        .prepare(
          `INSERT INTO field_photo_reports (visit_id, user_id, employee_id, client_id, comment, lat, lng, happened_at)
           VALUES (@visitId, @userId, @employeeId, @clientId, @comment, @lat, @lng, @at::timestamptz) RETURNING id`,
        )
        .get({ ...common, comment: input.report.comment ?? "" })) as { id: number }
      const owner = { kind: "photo_report" as const, id: Number(report.id) }
      await attachPhotos(tx, employeeId, input.report.beforePhotoIds ?? [], owner, "before", "report.beforePhotoIds")
      await attachPhotos(tx, employeeId, input.report.afterPhotoIds ?? [], owner, "after", "report.afterPhotoIds")
    }
    return { id: Number(visit.id), finished: true }
  })
  return { visit: (await getVisit(outcome.id))!, finished: outcome.finished }
}
