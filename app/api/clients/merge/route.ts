import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { getDb, withTransaction } from "@/lib/db"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const mergeSchema = z.object({
  survivorId: z.number().int().positive(),
  mergeIds: z.array(z.number().int().positive()).min(1).max(50),
})

// Tables that reference a client by its name rather than by id.
const CLIENT_NAME_COLUMNS: [table: string, column: string][] = [
  ["orders", "client"],
  ["customer_payments", "client"],
  ["contracts", "client"],
  ["cashback_withdrawal_requests", "client"],
  ["inventory_items", "client"],
  ["store_reconciliation_rows", "client"],
  ["cash_management_entries", "client_name"],
]

type ClientRow = { id: number; name: string; balance: number | string | null }

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const parsed = await parseJsonBody(request, mergeSchema)
  if (parsed.error) return parsed.error
  const { survivorId, mergeIds } = parsed.data
  const ids = Array.from(new Set(mergeIds)).filter((id) => id !== survivorId)
  if (ids.length === 0) return NextResponse.json({ error: "Выберите клиентов для объединения" }, { status: 400 })

  const db = getDb()
  const survivor = (await db.prepare("SELECT id, name, balance FROM clients WHERE id = ?").get(survivorId)) as ClientRow | undefined
  if (!survivor) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const merged: ClientRow[] = []
  for (const id of ids) {
    const row = (await db.prepare("SELECT id, name, balance FROM clients WHERE id = ?").get(id)) as ClientRow | undefined
    if (row) merged.push(row)
  }
  if (merged.length === 0) return NextResponse.json({ error: "Клиенты не найдены" }, { status: 404 })

  // All-or-nothing: a half-finished merge would leave orders pointing at a deleted client.
  await withTransaction(async (tx) => {
    let balance = Number(survivor.balance) || 0
    for (const row of merged) {
      balance += Number(row.balance) || 0
      if (row.name !== survivor.name) {
        for (const [table, column] of CLIENT_NAME_COLUMNS) {
          await tx.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(survivor.name, row.name)
        }
      }
      await tx.prepare("DELETE FROM clients WHERE id = ?").run(row.id)
    }
    await tx.prepare("UPDATE clients SET balance = ? WHERE id = ?").run(balance, survivor.id)
  })

  return NextResponse.json({ ok: true, merged: merged.length })
}
