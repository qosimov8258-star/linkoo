import { NextResponse } from "next/server"

import { ONEC_FILE_NAME, onecRows, onecWorkbook } from "@/lib/client-returns-onec"
import { parsePrintIds } from "@/lib/client-returns-print"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/client-returns/onec?ids=205-207 → OrderReturnOnec.xlsx: the returns list's «Скачать» → «Скачать для 1C»
// (the reference's sales/order_return/download_for_onec/?ids=…), one row per line of the chosen returns.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const ids = parsePrintIds(new URL(request.url).searchParams.getAll("ids"))
  if (!ids) return NextResponse.json({ error: "Выберите хотя бы один возврат !" }, { status: 400 })
  const buffer = onecWorkbook(await onecRows(ids))
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=${ONEC_FILE_NAME}`,
      "Cache-Control": "no-store",
    },
  })
}
