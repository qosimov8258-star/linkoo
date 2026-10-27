import "server-only"

import { getDb } from "@/lib/db"
import { localIso } from "@/lib/field-activity/input"
import { photosOf } from "@/lib/field-activity/photos-repo"
import { columnsOf, ensureFieldSchema } from "@/lib/field-activity/schema"
import type { FieldPhoto } from "@/lib/field-activity/types"

// One refusal / photo report by id, for the detail dialogs ("ОТЧЕТ № 58": Клиент, Инициатор,
// Время синхронизации, Время фото, Комментарий, До / После; the refusal image viewer).

export type FieldRecord = {
  id: number
  kind: "refusal" | "photo_report"
  visitId: number | null
  employeeId: number
  employeeName: string
  clientId: number
  clientName: string
  /** When it happened on the device (local). */
  at: string
  /** When the server received it (local): "Время синхронизации". */
  syncedAt: string
  comment: string
  /** Refusal: the current refusal type name, else the stored one. */
  reason: string
  refusalTypeId: number | null
  /** Photo report: pending. */
  status: string
  lat: number | null
  lng: number | null
  photos: FieldPhoto[]
}

type Row = {
  id: number
  visit_id: number | null
  employee_id: number
  employee_name: string | null
  client_id: number
  client_name: string | null
  happened_at: Date
  created_at: Date
  comment: string
  reason: string | null
  refusal_type_id: number | null
  status: string | null
  lat: number | null
  lng: number | null
}

const EMPLOYEE_NAME = "NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '')"
const num = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value))

/** A refusal or photo report by id (null when missing). */
export async function getFieldRecord(kind: "refusal" | "photo_report", id: number): Promise<FieldRecord | null> {
  await ensureFieldSchema()
  const db = getDb()
  let sql: string
  if (kind === "refusal") {
    const types = (await columnsOf(["refusal_types"])).get("refusal_types")?.has("name")
    sql = `SELECT f.id, f.visit_id, f.employee_id, ${EMPLOYEE_NAME} AS employee_name, f.client_id, c.name AS client_name, f.happened_at, f.created_at,
                  f.comment, ${types ? "COALESCE(rt.name, f.reason)" : "f.reason"} AS reason, f.refusal_type_id, NULL AS status, f.lat, f.lng
             FROM field_refusals f
             LEFT JOIN employees e ON e.id = f.employee_id
             LEFT JOIN clients c ON c.id = f.client_id
             ${types ? "LEFT JOIN refusal_types rt ON rt.id = f.refusal_type_id" : ""}
            WHERE f.id = ?`
  } else {
    sql = `SELECT f.id, f.visit_id, f.employee_id, ${EMPLOYEE_NAME} AS employee_name, f.client_id, c.name AS client_name, f.happened_at, f.created_at,
                  f.comment, NULL AS reason, NULL AS refusal_type_id, f.status, f.lat, f.lng
             FROM field_photo_reports f
             LEFT JOIN employees e ON e.id = f.employee_id
             LEFT JOIN clients c ON c.id = f.client_id
            WHERE f.id = ?`
  }
  const row = (await db.prepare(sql).get(id)) as Row | undefined
  if (!row) return null
  const photos = (await photosOf(kind, [Number(row.id)])).get(Number(row.id)) ?? []
  return {
    id: Number(row.id),
    kind,
    visitId: num(row.visit_id),
    employeeId: Number(row.employee_id),
    employeeName: row.employee_name ?? "",
    clientId: Number(row.client_id),
    clientName: row.client_name ?? "",
    at: localIso(new Date(row.happened_at).getTime()),
    syncedAt: localIso(new Date(row.created_at).getTime()),
    comment: row.comment ?? "",
    reason: row.reason ?? "",
    refusalTypeId: num(row.refusal_type_id),
    status: row.status ?? "",
    lat: num(row.lat),
    lng: num(row.lng),
    photos,
  }
}
