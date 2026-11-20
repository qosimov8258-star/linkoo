import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  createPerfectStoreConfig,
  listPerfectStoreConfigs,
  perfectStoreConfigBody,
  perfectStoreConfigErrorResponse,
} from "@/lib/perfect-store-configs-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// Perfect Store Config (lib/perfect-store-configs-repo.ts): the questionnaire sets of a perfect store visit. Under
// /api/surveys, so a write needs the permission of the questionnaires (clients.manage, lib/capabilities-catalog.ts).
//
// GET  /api/surveys/perfect-store-configs?search=&page=1&pageSize=25 → {count, rows}
// POST /api/surveys/perfect-store-configs {name, organizationId, isActive, items: [{quizId, isStoreQuiz}]} → the config
//      (400 "Обязательное поле" / "Организация не найдена" / "Опросник не найден" with the field).
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const params = request.nextUrl.searchParams
  const page = Number(params.get("page") ?? "1")
  const pageSize = Number(params.get("pageSize") ?? "25")
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    return NextResponse.json({ error: "Неверное значение" }, { status: 400 })
  }
  const search = (params.get("search") ?? "").trim().slice(0, 200)
  return NextResponse.json(await listPerfectStoreConfigs({ search, page, pageSize }))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, perfectStoreConfigBody)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createPerfectStoreConfig(parsed.data), { status: 201 })
  } catch (error) {
    const response = perfectStoreConfigErrorResponse(error)
    if (response) return response
    throw error
  }
}
