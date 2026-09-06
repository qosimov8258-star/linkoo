import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { listPermissions } from "@/lib/permissions-repo"

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json((await listPermissions()))
}
