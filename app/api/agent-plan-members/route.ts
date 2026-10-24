import { NextResponse } from "next/server"

import { listAgentPlanMembers } from "@/lib/agent-plan-members-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/agent-plan-members — the employees of the agent plan ("Анализ маршрутов" agents list).
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listAgentPlanMembers())
}
