import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dictionaryWrite } from "@/lib/dictionaries-schema"
import { knowledgeBaseFeed, positionOfEmployee } from "@/lib/knowledge-base-repo"
import { PASSWORD_CHANGE_REQUIRED, PASSWORD_CHANGE_REQUIRED_CODE } from "@/lib/rbac"
import { invalidFieldResponse, notSignedInResponse } from "@/lib/validation"

// GET /api/knowledge-base/feed?since=<ISO time> — the knowledge base of the caller's mobile app
// (demo: articles are published to the staff whose position is in "Права доступа"). Read-only,
// for any signed-in user: the ACTIVE articles listed for the job position of the employee the
// account belongs to (employees.position), plus those listed for no position (every position).
// {serverTime, position, visibleIds, articles: [{id, name, text, file, updatedAt}]}: without
// `since` every visible article; with it only those changed at or after it (pass the previous
// serverTime), and visibleIds tells which ones to keep. The PDF is GET file.url.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  if (user.mustChangePassword) {
    return NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 })
  }
  const raw = (new URL(request.url).searchParams.get("since") ?? "").trim()
  let since: string | null = null
  if (raw) {
    const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : Number.NaN
    const year = Number.isNaN(time) ? 0 : new Date(time).getUTCFullYear()
    if (year < 2000 || year > 2100) return invalidFieldResponse("since", "YYYY-MM-DDTHH:MM:SSZ", "Неверная дата")
    since = `${new Date(time).toISOString().slice(0, 19)}Z`
  }
  return dictionaryWrite(async () => NextResponse.json(await knowledgeBaseFeed(await positionOfEmployee(user.employeeId), since)))
}
