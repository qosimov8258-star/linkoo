import { NextResponse } from "next/server"

import { RECEIPT_ORDERINGS } from "@/components/analytics/receipt-templates-data"
import { getCurrentUser } from "@/lib/current-user"
import { dictionaryListQuery } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { createReceiptTemplate, listReceiptTemplates } from "@/lib/receipt-templates-repo"
import { readReceiptBody } from "./body"

// GET /api/receipt-templates?page&pageSize&search&ordering — demo sales/check/template/: {count, results}.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const query = dictionaryListQuery(new URL(request.url).searchParams, RECEIPT_ORDERINGS)
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listReceiptTemplates(query))
}

// POST {name, printAutoCheck, headers: [{name, isBold, position}], footers: [...]}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const body = await readReceiptBody(request)
  if (!body) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  if (Object.keys(body.fields).length) return NextResponse.json({ error: "Неверные данные", fields: body.fields }, { status: 400 })
  return NextResponse.json(await createReceiptTemplate(body.data), { status: 201 })
}
