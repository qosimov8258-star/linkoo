import { NextResponse } from "next/server"

import { requireFieldReader } from "@/lib/field-activity/actor"
import { taskErrorResponse, taskOptions } from "@/lib/tasks-repo"

// GET /api/tasks/options → {clients: [{id, name, hint, agentId}], employees: [{id, name, hint, active}],
// creators: [{id, name}]}: the pickers of the task dialog and the filter, within the reader's field
// scope (lib/field-activity/actor.ts: an agent's pickers list only their own employee and the agents
// they supervise); a user without any field scope gets 403.
export async function GET() {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  try {
    return NextResponse.json(await taskOptions(reader.scope))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
