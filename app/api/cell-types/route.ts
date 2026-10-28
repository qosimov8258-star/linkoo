import { NextResponse } from "next/server"

import { cellTypeBodySchema } from "@/lib/cells-api"
import { createCellType, listCellTypeTree, listCellTypes } from "@/lib/cells-repo"
import { getCurrentUser } from "@/lib/current-user"
import { dictionaryWrite } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/cell-types — plain array of every cell type; with ?view=tree (and optional ?search) the
// grid of the page {count, results: tree} (demo stock/cell_type/hierarchy/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const params = new URL(request.url).searchParams
  if (params.get("view") !== "tree") return NextResponse.json(await listCellTypes())
  const results = await listCellTypeTree((params.get("search") ?? "").trim())
  return NextResponse.json({ count: results.length, results })
}

// POST /api/cell-types {name, parentId} — demo POST stock/cell_type/.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, cellTypeBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => NextResponse.json(await createCellType({ name: parsed.data.name, parentId: parsed.data.parentId ?? null }), { status: 201 }))
}
