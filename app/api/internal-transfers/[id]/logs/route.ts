import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listTransferLogs } from "@/lib/internal-transfers-repo"

type RouteParams = { params: Promise<{ id: string }> }

/** "Логи": every action with who / when and a snapshot of the lines. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listTransferLogs(Number((await params).id) || 0))
}
