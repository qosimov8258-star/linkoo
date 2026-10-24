import { NextResponse } from "next/server"

import { cellBodySchema } from "@/lib/cells-api"
import { createCell, listCellsPage } from "@/lib/cells-repo"
import { getCurrentUser } from "@/lib/current-user"
import { dictionaryListQuery, dictionaryWrite } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/cells?search&page&pageSize — {count, results} (demo stock/cell/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const query = dictionaryListQuery(new URL(request.url).searchParams, [])
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listCellsPage(query))
}

// POST /api/cells {name, barcode, cellTypeId} — demo POST stock/cell/.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, cellBodySchema)
  if (parsed.error) return parsed.error
  const { name, barcode, cellTypeId } = parsed.data
  return dictionaryWrite(async () => NextResponse.json(await createCell({ name, barcode: barcode ?? "", cellTypeId: cellTypeId ?? null }), { status: 201 }))
}
