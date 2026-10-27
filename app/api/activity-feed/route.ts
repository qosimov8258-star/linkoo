import { NextRequest, NextResponse } from "next/server"

import { agentTiles, feedTotals, listFeed, type FeedKind } from "@/lib/activity-feed-repo"
import { getCurrentUser } from "@/lib/current-user"

const KINDS: FeedKind[] = ["order", "delivery", "payment", "report", "rejection", "return"]
const DAY = /^\d{4}-\d{2}-\d{2}$/

// GET /api/activity-feed?view=totals|tiles|list&begin=YYYY-MM-DD&end=YYYY-MM-DD[&agent=ID][&kind=order&page=1]
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const p = request.nextUrl.searchParams
  const begin = p.get("begin") ?? ""
  const end = p.get("end") ?? begin
  if (!DAY.test(begin) || !DAY.test(end)) return NextResponse.json({ error: "begin/end" }, { status: 400 })
  const agent = Number(p.get("agent")) || null
  const view = p.get("view") ?? "list"
  if (view === "totals") return NextResponse.json(await feedTotals(begin, end, agent))
  if (view === "tiles") return NextResponse.json(await agentTiles(begin, end))
  const kind = p.get("kind") as FeedKind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "kind" }, { status: 400 })
  return NextResponse.json(await listFeed(kind, begin, end, agent, Number(p.get("page")) || 1))
}
