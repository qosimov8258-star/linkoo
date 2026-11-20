import "server-only"

import { z } from "zod"

import { logClientReturn } from "@/lib/client-return-logs-repo"
import { ClientReturnError, ensureClientReturnsSchema } from "@/lib/client-returns-repo"
import { getDb, withTransaction } from "@/lib/db"
import { loadEntities } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { resolveEmployee } from "@/lib/orders-repo"

// «Изменить выбранные возвраты» of the returns list (the reference's «Изменение выбранных возвратов», POST
// sales/order_return/bulk_update/ {order_returns, responsible_agent, delivery_man}): the responsible agent and / or the
// delivery man of every chosen return, whatever its status. A field left empty keeps each return's own value. The
// names are checked like the return edit checks them (an employee of that name), and every return that changed gets
// an «Обновленный» row in its log.

const MAX_ID = 2_147_483_647
const id = z.number({ error: "Неверный идентификатор" }).int({ error: "Неверный идентификатор" }).positive({ error: "Неверный идентификатор" }).max(MAX_ID, { error: "Неверный идентификатор" })
const name = z.string({ error: "Неверные данные" }).trim().max(200, { error: "Слишком длинное значение" })

export const clientReturnBulkUpdateSchema = z.object({
  ids: z.array(id).min(1, { error: "Выберите хотя бы один возврат !" }).max(500, { error: "Слишком много возвратов" }),
  agent: name.optional(),
  deliverer: name.optional(),
})

export type ClientReturnBulkUpdate = z.infer<typeof clientReturnBulkUpdateSchema>

/** Sets the chosen fields on every return of `ids` (all or nothing); answers how many returns changed. */
export async function bulkUpdateClientReturns(input: ClientReturnBulkUpdate, user: { displayName: string }): Promise<{ updated: number }> {
  await ensureClientReturnsSchema()
  const ids = [...new Set(input.ids)]
  return withTransaction(async (tx) => {
    const agent = input.agent ? await resolveEmployee(tx, input.agent, "agent", "Ответственный агент") : null
    const deliverer = input.deliverer ? await resolveEmployee(tx, input.deliverer, "deliverer", "Доставщик") : null
    const rows = (await tx.prepare("SELECT id, agent, deliverer FROM client_returns WHERE id = ANY(?::int[]) ORDER BY id FOR UPDATE").all(ids)) as Array<{ id: number; agent: string | null; deliverer: string | null }>
    if (rows.length !== ids.length) throw new ClientReturnError("Возврат не найден", 404, { field: "ids" })
    let updated = 0
    for (const row of rows) {
      const nextAgent = agent ?? row.agent ?? ""
      const nextDeliverer = deliverer ?? row.deliverer ?? ""
      if (nextAgent === (row.agent ?? "") && nextDeliverer === (row.deliverer ?? "")) continue
      await tx.prepare("UPDATE client_returns SET agent = @agent, deliverer = @deliverer, updated_at = datetime('now') WHERE id = @id").run({ id: row.id, agent: nextAgent, deliverer: nextDeliverer })
      await logClientReturn(tx, row.id, "updated", user.displayName)
      updated += 1
    }
    return { updated }
  })
}

export type BulkUpdatePerson = { id: number; name: string }

/** The dialog's lists as the reference loads them (main/crud/for_select, and ?group=delivery): one entry per active
 * user by id, namesakes included (lib/order-create-options.ts merges them for the order form). */
export async function bulkUpdatePeople(): Promise<{ agents: BulkUpdatePerson[]; deliverers: BulkUpdatePerson[] }> {
  const db = getDb()
  const employees = (await db.prepare("SELECT id, first_name, last_name, active FROM employees ORDER BY id").all()) as Array<{ id: number; first_name: string | null; last_name: string | null; active: number | null }>
  const agents = employees
    .filter((row) => Number(row.active ?? 1) === 1)
    .map((row) => ({ id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() }))
    .filter((row) => row.name)
  let deliverers: BulkUpdatePerson[] = []
  try {
    const records = await loadEntities("deliverer", db, await ensureFinanceSchema(db))
    const delivery = new Set(records.filter((record) => Number(record.info.is_deliverer) === 1 && record.id !== null).map((record) => Number(record.id)))
    deliverers = agents.filter((row) => delivery.has(row.id))
  } catch {
    deliverers = []
  }
  return { agents, deliverers }
}
