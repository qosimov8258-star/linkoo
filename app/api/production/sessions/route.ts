import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { dateParamError, errorResponse, guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer } from "@/lib/production-api"
import { listSessions, openSession } from "@/lib/production-sessions-repo"
import { sessionOpenSchema } from "@/lib/production-sessions-schemas"

// Этапы производства → Активность → «Смены»: the worker shift sessions of a stage (Linko's staff/personal_rotation).
const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]

/** GET /api/production/sessions?stageId&from&to[&shift=<name> (repeatable)&worker&page&pageSize] → {count, page, pageSize, results}. */
export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  const from = params.get("from")
  const to = params.get("to")
  const badDate = dateParamError(params, "from", "to")
  if (badDate) return badDate
  if (!stageId || !isDateParam(from) || !isDateParam(to)) return errorResponse("stageId, from и to обязательны")
  const size = Number(params.get("pageSize") ?? 25)
  if (!PAGE_SIZES.includes(size)) return errorResponse("Неверное значение", 400, { field: "pageSize" })
  const pageText = params.get("page")
  const page = pageText === null || pageText === "" ? 1 : positiveIntParam(pageText)
  if (!page) return errorResponse("Неверное значение", 400, { field: "page" })
  const shifts = params
    .getAll("shift")
    .map((value) => value.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 50)
  return guarded(async () =>
    NextResponse.json(
      await listSessions(
        stageId,
        { from: from <= to ? from : to, to: from <= to ? to : from, shifts, worker: params.get("worker")?.trim().slice(0, 255) || undefined },
        { page, pageSize: size },
      ),
    ),
  )
}

/** POST {stageId, employeeId, shiftId, openedAt?} — «Открыть смену» (a supervisor, on the web). 201 → the session. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, sessionOpenSchema)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const session = await openSession(parsed.data, auth.user.displayName)
    if (session === "stage_not_found") return notFound("Этап не найден")
    return NextResponse.json(session, { status: 201 })
  })
}
