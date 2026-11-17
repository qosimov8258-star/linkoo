import { NextResponse } from "next/server"
import { z } from "zod"

import { ClientError, mergeClients } from "@/lib/clients-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/clients/merge ← { survivorId, mergeIds } — «Объединение клиентов» (Анализ дублей): every document and
// setting of the merged clients passes to the survivor and they are deleted (lib/clients-repo.ts mergeClients).
// → { ok, merged, survivor: { id, name } }

const mergeSchema = z.object({
  survivorId: z.number().int().positive().max(2_147_483_647),
  mergeIds: z.array(z.number().int().positive().max(2_147_483_647)).min(1).max(50),
})

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, mergeSchema)
  if (parsed.error) return parsed.error
  try {
    const result = await mergeClients(parsed.data.survivorId, parsed.data.mergeIds)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof ClientError) return NextResponse.json({ error: error.message, ...(error.extra ?? {}) }, { status: error.status })
    throw error
  }
}
