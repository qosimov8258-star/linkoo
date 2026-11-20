import { NextResponse } from "next/server"

import { listAccessRights } from "@/lib/access-rights-repo"
import { requireRole } from "@/lib/rbac"

// GET /api/knowledge-base/access-rights — the options of the article form's "Права доступа"
// (Linko main/position/ of the knowledge form): [{id, name}] by id. Only for those who may
// change the knowledge base (the same check as POST /api/knowledge-base); the access rights
// themselves stay behind the admin-only /api/access-rights.
export async function GET() {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  return NextResponse.json((await listAccessRights()).map((right) => ({ id: right.id, name: right.name })))
}
