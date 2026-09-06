import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createProductionBatch, listProductionBatches } from "@/lib/production-batches-repo"

const productionBatchSchema = z.object({
  batchDate: z.string().trim().min(1),
  stage: z.string().trim().min(1),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  user: z.string().trim().optional(),
  status: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listProductionBatches()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, productionBatchSchema)
  if (parsed.error) return parsed.error

  const batch = (await createProductionBatch({
    batchDate: parsed.data.batchDate,
    stage: parsed.data.stage,
    startedAt: parsed.data.startedAt ?? "",
    completedAt: parsed.data.completedAt ?? "",
    user: parsed.data.user || "Admin Ritm",
    status: parsed.data.status || "В процессе",
  }))
  return NextResponse.json(batch, { status: 201 })
}
