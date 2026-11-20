import { NextResponse } from "next/server"
import { z } from "zod"

import { ballValue, recordId } from "@/app/api/client-bonuses/shared"
import { addCustomBalls, ClientBonusError } from "@/lib/client-bonuses-repo"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.strictObject({
  client: recordId,
  promotion: recordId,
  ball: ballValue,
  comment: z.string().trim().min(1, "Обязательное поле").max(1000, "Слишком длинное значение"),
})

// POST /api/client-bonuses/custom-ball {client, promotion, ball, comment} — «Добавить балл» (Linko's
// sales/client_promotion/custom_ball/): one hand score of a client under a «Балл» promotion; `ball` is negative for
// «Минусовой балл».
export const POST = withDbErrors(async (request: Request) => {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const { client, promotion, ball, comment } = parsed.data
  try {
    await addCustomBalls(promotion, [{ clientId: client, ball, comment }], auth.user.id)
  } catch (error) {
    if (error instanceof ClientBonusError) return NextResponse.json({ error: error.message, field: error.field }, { status: error.status })
    throw error
  }
  return NextResponse.json({ ok: true }, { status: 201 })
})
