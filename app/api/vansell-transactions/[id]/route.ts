import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { vansellTransactionUpdateSchema } from "@/lib/finance-vansell-balance-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteVansellTransaction, getVansellTransaction, updateVansellTransaction } from "@/lib/vansell-transactions-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const transaction = Number.isInteger(id) && id > 0 ? await getVansellTransaction(id) : null
  if (!transaction) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(transaction)
}

/** Edit of a manual ("Нет типа") movement from the detail dialog. */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, vansellTransactionUpdateSchema)
  if (parsed.error) return parsed.error

  const result = await updateVansellTransaction(id, parsed.data)
  if (result === "not_found") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  if (result === "not_editable") return NextResponse.json({ error: "Изменять можно только движения без типа" }, { status: 409 })
  if (result === "employee_not_found") return NextResponse.json({ error: "Вансел не найден" }, { status: 404 })
  if (result === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  return NextResponse.json(result)
}

/** Soft delete of a manual ("Нет типа") movement. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  const result = await deleteVansellTransaction(id)
  if (result === "not_found") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  if (result === "not_editable") return NextResponse.json({ error: "Удалять можно только движения без типа" }, { status: 409 })
  return NextResponse.json({ id, deleted: true })
}
