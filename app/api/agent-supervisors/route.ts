import { NextResponse } from "next/server"

import { listAgentSupervisors } from "@/lib/agent-supervisors-repo"
import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"

// GET /api/agent-supervisors → [{agentId, agent, supervisorId, supervisor}]: the supervisor filter of
// the field reports (Время работы агента). Only the agents of the reader's field scope
// (lib/field-activity/actor.ts): an agent gets at most their own pair (and their agents' pairs as a
// supervisor); a user without any field scope gets 403.
export async function GET() {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  return fieldRoute(async () => NextResponse.json(await listAgentSupervisors(scopedEmployeeIds(reader.scope, undefined))))
}
