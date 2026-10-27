import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { taskErrorResponse, taskOptions } from "@/lib/tasks-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/tasks/options → {clients: [{id, name, hint, agentId}], employees: [{id, name, hint, active}],
// creators: [{id, name}]}: the pickers of the task dialog and the filter. Any signed-in user.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  try {
    return NextResponse.json(await taskOptions())
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
