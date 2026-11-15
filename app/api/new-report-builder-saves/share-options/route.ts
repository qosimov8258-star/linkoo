import { NextResponse } from "next/server"

import { requirePermission } from "@/lib/rbac"
import { listNewReportBuilderShareOptions } from "@/lib/new-report-builder-repo"

// GET /api/new-report-builder-saves/share-options — the accounts and access rights «ПОЛЬЗОВАТЕЛИ» of a saved
// constructor report picks from; for the ones who may change saves.
export async function GET() {
  const auth = await requirePermission("reports.manage", "manager")
  if ("error" in auth) return auth.error
  return NextResponse.json(await listNewReportBuilderShareOptions())
}
