import { NextResponse } from "next/server"

import { ensureClientBonusesSchema, listBallPromotions } from "@/lib/client-bonuses-repo"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/client-bonuses/promotions → [{id, name}]: the «Балл» promotions balls are scored under (the «Акция» field of
// the page's filter, «Добавить балл» and the import, Linko's promotion field with type=ball), newest first.
export const GET = withDbErrors(async () => {
  if (!(await getCurrentUser())) return notSignedInResponse()
  await ensureClientBonusesSchema()
  return NextResponse.json(await listBallPromotions())
})
