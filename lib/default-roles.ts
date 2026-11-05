import "server-only"

import { readSetting, writeSetting } from "@/lib/app-settings"
import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

// Права доступа a new company starts with, as a new Linko account has them (app.linko.uz #/position): the
// roles Агент, Доставщик, Супервайзер, Инкассатор, Мерчендайзер, Кассир, Зав. склад and Супер-Админ, each made
// of its role capability ("Кассир" — the employee form and the staff lists find cashiers, storekeepers,
// supervisors and delivery men by these names) and its "… | Функции" capability with what the role may change
// (the permission codes of lib/capabilities-catalog.ts). Written once, only into a database without any
// access right (a fresh install): a capability of the same name that already exists is used as it is, a
// company's own roles are never touched, and roles deleted later do not come back (the app_settings mark).

const SEED_KEY = "seed:default_access_rights"

type CapabilitySeed = { name: string; codes: string[] | "all" }

const CAPABILITIES: CapabilitySeed[] = [
  { name: "Агент", codes: [] },
  { name: "Агент | Функции", codes: ["orders.manage", "clients.manage", "payments.manage"] },
  { name: "Доставщик", codes: [] },
  { name: "Доставщик | Функции", codes: ["orders.manage", "payments.manage"] },
  { name: "Супервайзер", codes: ["clients.manage", "reports.manage"] },
  { name: "Супервайзер | Функции", codes: ["orders.manage", "clients.manage", "payments.manage"] },
  { name: "Инкассатор", codes: [] },
  { name: "Инкассатор | Функции", codes: ["payments.manage"] },
  { name: "Мерчендайзер", codes: [] },
  { name: "Мерчендайзер | Функции", codes: ["clients.manage"] },
  { name: "Кассир", codes: ["cash.manage"] },
  { name: "Кассир | Функции", codes: ["cash.manage", "payments.manage"] },
  { name: "Завсклад", codes: ["stock.manage"] },
  { name: "Зав.Склад | Функции", codes: ["stock.manage", "procurement.manage", "catalog.manage"] },
  { name: "All", codes: "all" },
  { name: "Доступ админ", codes: "all" },
]

const ACCESS_RIGHTS: Array<{ name: string; capabilities: string[] | "all" }> = [
  { name: "Агент", capabilities: ["Агент", "Агент | Функции"] },
  { name: "Доставщик", capabilities: ["Доставщик", "Доставщик | Функции"] },
  { name: "Супервайзер", capabilities: ["Супервайзер", "Супервайзер | Функции"] },
  { name: "Инкассатор", capabilities: ["Инкассатор", "Инкассатор | Функции"] },
  { name: "Мерчендайзер", capabilities: ["Мерчендайзер", "Мерчендайзер | Функции"] },
  { name: "Кассир", capabilities: ["Кассир", "Кассир | Функции"] },
  { name: "Зав. склад", capabilities: ["Завсклад", "Зав.Склад | Функции"] },
  { name: "Супер-Админ", capabilities: "all" },
]

declare global {
  var __linkoDefaultRoles: Promise<void> | undefined
}

/** Writes the default roles once (see above); cheap after the first call of the process. */
export function ensureDefaultRoles(): Promise<void> {
  globalThis.__linkoDefaultRoles ??= outsideTransaction(seedDefaultRoles).catch((error: unknown) => {
    globalThis.__linkoDefaultRoles = undefined
    throw error
  })
  return globalThis.__linkoDefaultRoles
}

async function seedDefaultRoles(): Promise<void> {
  // The mark is read first without the lock: every later process start stops here.
  if (await readSetting(getDb(), SEED_KEY)) return
  await withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:default-roles')) AS ok").get()
    if (await readSetting(tx, SEED_KEY)) return
    const rights = (await tx.prepare("SELECT COUNT(*)::int AS n FROM access_rights").get()) as { n: number }
    if (!rights.n) {
      const permissions = (await tx.prepare("SELECT id, code FROM permissions ORDER BY sort_order, id").all()) as Array<{ id: number; code: string }>
      const permissionId = new Map(permissions.map((row) => [row.code, Number(row.id)]))
      const existing = (await tx.prepare("SELECT id, name FROM capabilities").all()) as Array<{ id: number; name: string }>
      const existingId = new Map(existing.map((row) => [row.name.trim().toLowerCase(), Number(row.id)]))
      const capabilityId = new Map<string, number>()
      for (const capability of CAPABILITIES) {
        const found = existingId.get(capability.name.toLowerCase())
        if (found !== undefined) {
          capabilityId.set(capability.name, found)
          continue
        }
        const ids = capability.codes === "all" ? permissions.map((row) => Number(row.id)) : capability.codes.flatMap((code) => permissionId.get(code) ?? [])
        const result = await tx.prepare("INSERT INTO capabilities (name, permission_ids) VALUES (@name, @ids)").run({ name: capability.name, ids: JSON.stringify(ids) })
        capabilityId.set(capability.name, Number(result.lastInsertRowid))
      }
      for (const right of ACCESS_RIGHTS) {
        const ids = right.capabilities === "all" ? [...capabilityId.values()] : right.capabilities.map((name) => capabilityId.get(name)!)
        await tx.prepare("INSERT INTO access_rights (name, capability_ids) VALUES (@name, @ids)").run({ name: right.name, ids: JSON.stringify(ids) })
      }
    }
    await writeSetting(tx, SEED_KEY, rights.n ? "skipped: the company has its own roles" : "written")
  })
}
