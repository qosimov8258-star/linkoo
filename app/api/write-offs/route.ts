import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { parseWriteOffListQuery, toWriteOffInput, writeOffBodySchema, writeOffResponse } from "@/lib/write-offs-api"
import { createWriteOff, listAllWriteOffs, listWriteOffs } from "@/lib/write-offs-repo"

/** List. With page / pageSize: `{count, page, pageSize, results}`; without: the legacy array. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const query = parseWriteOffListQuery(request.url)
  return NextResponse.json(query ? await listWriteOffs(query) : await listAllWriteOffs())
}

/** "Списать": created finished (status 'закрыт', refused beyond the available stock) unless status 'ожидает'. */
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, writeOffBodySchema)
  if (parsed.error) return parsed.error

  return writeOffResponse(await createWriteOff(toWriteOffInput(parsed.data), auth.user.displayName), true)
}
