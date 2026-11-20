import { NextResponse } from "next/server"
import { z } from "zod"

import { ballValue, recordId } from "@/app/api/client-bonuses/shared"
import { addCustomBalls, ClientBonusError } from "@/lib/client-bonuses-repo"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

/** Rows of one import at most (a client list of a large account fits). */
const MAX_ROWS = 20000

const schema = z.strictObject({
  promotion: recordId,
  rows: z
    .array(
      z.strictObject({
        client: recordId,
        ball: ballValue,
        comment: z.string().trim().max(1000, "Слишком длинное значение").default(""),
      }),
    )
    .min(1, "Добавьте хотя бы одну строку")
    .max(MAX_ROWS, "Слишком много значений"),
})

// POST /api/client-bonuses/import {promotion, rows: [{client, ball, comment?}]} — «Импортировать» (Linko's
// sales/client_promotion/update_excel/): the filled rows of the template («№», «Балл(*)», «Комментарий») scored under
// one «Балл» promotion, all or nothing.
export const POST = withDbErrors(async (request: Request) => {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const { promotion, rows } = parsed.data
  try {
    const count = await addCustomBalls(
      promotion,
      rows.map((row) => ({ clientId: row.client, ball: row.ball, comment: row.comment })),
      auth.user.id,
    )
    return NextResponse.json({ ok: true, count }, { status: 201 })
  } catch (error) {
    if (error instanceof ClientBonusError) return NextResponse.json({ error: error.message, field: error.field }, { status: error.status })
    throw error
  }
})
