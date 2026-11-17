import { NextResponse, type NextRequest } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getReportSharing, listSharingOptions, setReportSharing, type SharingKind } from "@/lib/old-saved-reports-repo"
import { reportSharingSchema } from "../../schema"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Отчет не найден" }

// Linko's «Пользователи» of a saved report (?kind=static: of a static widget): who it is given to.
const kindOf = (request: NextRequest): SharingKind => (request.nextUrl.searchParams.get("kind") === "static" ? "static" : "report")

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  const sharing = id ? await getReportSharing(kindOf(request), id) : null
  if (!sharing) return NextResponse.json(NOT_FOUND, { status: 404 })
  // The dialog's choices come with it: a manager may share with access rights without reading their admin list.
  return NextResponse.json({ ...sharing, options: await listSharingOptions() })
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, reportSharingSchema)
  if (parsed.error) return parsed.error

  const sharing = await setReportSharing(kindOf(request), id, parsed.data)
  if (!sharing) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(sharing)
}
