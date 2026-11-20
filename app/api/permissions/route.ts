import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { listPermissionCategories, listPermissionTags, listPermissions } from "@/lib/permissions-repo"

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const [permissions, categories, tags] = await Promise.all([listPermissions(), listPermissionCategories(), listPermissionTags()])
  return NextResponse.json({ permissions, categories, tags })
}
