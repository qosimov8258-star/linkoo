import "server-only"

import type { PgDb } from "@/lib/db"
import { leadingNumber } from "@/lib/stock/catalog"

// What the models of the old report builder look up about a product, a client (a shop), an employee and a
// warehouse: one query per directory and report run, made the first time a model asks for it.

export type ProductInfo = {
  id: number
  name: string
  unit: string
  brand: string
  type: string
  /** The type above the product's type (product_types.parent_id); "" for a top type. */
  parentType: string
  /** Порядковый номер (products.order_number). */
  orderNumber: string
  article: string
  /** Код (products.integration_code). */
  code: string
  barcode: string
  /** Units in a block (products.box_amount; 0 = sold without blocks). */
  box: number
  /** Weight of a unit, kg. */
  kg: number
  organization: string
  mml: boolean
  trackExpiry: boolean
}

export type ClientInfo = {
  id: number
  name: string
  inn: string
  type: string
  zone: string
  agent: string
  deliverer: string
  code: string
  contact: string
  branch: string
  /** Категория канала (clients.sales_channel). */
  channel: string
  /** Not closed (clients.tab <> 'closing'). */
  active: boolean
  phone: string
  address: string
  landmark: string
  note: string
  /** Local "YYYY-MM-DD HH:mm:ss". */
  createdAt: string
  /** Values of the client's attributes (Настройки → Атрибуты клиентов) by attribute name. */
  attributes: Record<string, string>
}

export type EmployeeInfo = {
  id: number
  name: string
  firstName: string
  lastName: string
  login: string
  /** Код сотрудника (employees.integration_code). */
  code: string
  position: string
  branch: string
  active: boolean
  supervisor: string
  /** The auditors of the employee: the employees whose card lists them among the audited agents. */
  auditors: string
}

export type GearInfo = { count: number; names: string }

const key = (value: unknown) => String(value ?? "").trim().toLowerCase()
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const NO_VALUE = /^не установлен|^не указан/i

export class Directory {
  private cache = new Map<string, Promise<unknown>>()
  constructor(private readonly db: PgDb) {}

  private once<T>(name: string, load: () => Promise<T>): Promise<T> {
    let found = this.cache.get(name) as Promise<T> | undefined
    if (!found) {
      found = load()
      this.cache.set(name, found)
    }
    return found
  }

  private rows(sql: string) {
    return this.db.prepare(sql).all() as Promise<Record<string, unknown>[]>
  }

  /** Products by id (deleted ones included: old documents still name them). */
  products(): Promise<Map<number, ProductInfo>> {
    return this.once("products", async () => {
      const types = await this.rows("SELECT id, name, parent_id FROM product_types").catch(() => [])
      const typeById = new Map(types.map((row) => [Number(row.id), row]))
      const parentOf = new Map<string, string>()
      for (const row of types) {
        const parent = row.parent_id === null ? undefined : typeById.get(Number(row.parent_id))
        if (parent) parentOf.set(key(row.name), str(parent.name))
      }
      const rows = await this.rows(
        `SELECT id, name, unit, brand, type, order_number, article, integration_code, barcode, box_amount, weight, organization,
                COALESCE((to_jsonb(p) ->> 'only_mml')::int, 0) AS only_mml, COALESCE((to_jsonb(p) ->> 'track_expiry')::int, 0) AS track_expiry
           FROM products p`,
      )
      return new Map(
        rows.map((row) => {
          const barcode = str(row.barcode)
          const info: ProductInfo = {
            id: Number(row.id),
            name: str(row.name),
            unit: str(row.unit),
            brand: str(row.brand),
            type: str(row.type),
            parentType: parentOf.get(key(row.type)) ?? "",
            orderNumber: str(row.order_number),
            article: str(row.article),
            code: str(row.integration_code),
            barcode: NO_VALUE.test(barcode) ? "" : barcode,
            box: Math.max(0, Number(row.box_amount) || 0),
            kg: Math.max(0, leadingNumber(row.weight)),
            organization: str(row.organization),
            mml: Number(row.only_mml) === 1,
            trackExpiry: Number(row.track_expiry) === 1,
          }
          return [info.id, info] as const
        }),
      )
    })
  }

  /** Products by lower-cased name: document lines without a product id (the first product of a name). */
  productsByName(): Promise<Map<string, ProductInfo>> {
    return this.once("productsByName", async () => {
      const map = new Map<string, ProductInfo>()
      for (const product of (await this.products()).values()) if (!map.has(key(product.name))) map.set(key(product.name), product)
      return map
    })
  }

  clients(): Promise<Map<number, ClientInfo>> {
    return this.once("clients", async () => {
      const rows = await this.rows(
        `SELECT id, name, phone, inn, type, zone, agent, deliverer, code, contact_person, branch, sales_channel, tab, address, landmark, note,
                COALESCE(to_char(fin_ts(created_at, true), 'YYYY-MM-DD HH24:MI:SS'), '') AS created_local, attributes
           FROM clients`,
      )
      return new Map(
        rows.map((row) => {
          let attributes: Record<string, string> = {}
          try {
            const parsed = JSON.parse(str(row.attributes) || "{}") as Record<string, unknown>
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              attributes = Object.fromEntries(Object.entries(parsed).filter(([name]) => !name.startsWith("_")).map(([name, value]) => [name, str(value)]))
            }
          } catch {
            attributes = {}
          }
          const info: ClientInfo = {
            id: Number(row.id),
            name: str(row.name),
            inn: str(row.inn),
            type: str(row.type),
            zone: str(row.zone),
            agent: NO_VALUE.test(str(row.agent)) ? "" : str(row.agent),
            deliverer: NO_VALUE.test(str(row.deliverer)) ? "" : str(row.deliverer),
            code: str(row.code),
            contact: str(row.contact_person),
            branch: str(row.branch),
            channel: str(row.sales_channel),
            active: str(row.tab) !== "closing",
            phone: str(row.phone),
            address: str(row.address),
            landmark: str(row.landmark),
            note: str(row.note),
            createdAt: str(row.created_local),
            attributes,
          }
          return [info.id, info] as const
        }),
      )
    })
  }

  clientsByName(): Promise<Map<string, ClientInfo>> {
    return this.once("clientsByName", async () => {
      const map = new Map<string, ClientInfo>()
      for (const client of (await this.clients()).values()) if (!map.has(key(client.name))) map.set(key(client.name), client)
      return map
    })
  }

  employees(): Promise<Map<number, EmployeeInfo>> {
    return this.once("employees", async () => {
      const rows = await this.rows("SELECT id, first_name, last_name, login, integration_code, position, branch, active, details FROM employees")
      const name = (row: Record<string, unknown>) => `${str(row.first_name)} ${str(row.last_name)}`.trim()
      const nameById = new Map(rows.map((row) => [Number(row.id), name(row)]))
      const details = new Map<number, { supervisorId: number | null; audited: number[] }>()
      for (const row of rows) {
        let supervisorId: number | null = null
        let audited: number[] = []
        try {
          const parsed = JSON.parse(str(row.details) || "{}") as { supervisorId?: unknown; auditAgentIds?: unknown }
          supervisorId = Number.isInteger(Number(parsed.supervisorId)) && Number(parsed.supervisorId) > 0 ? Number(parsed.supervisorId) : null
          audited = Array.isArray(parsed.auditAgentIds) ? parsed.auditAgentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
        } catch {
          // a card without details
        }
        details.set(Number(row.id), { supervisorId, audited })
      }
      const auditorsOf = new Map<number, string[]>()
      for (const [auditorId, info] of details) {
        for (const agentId of info.audited) {
          const list = auditorsOf.get(agentId) ?? []
          list.push(nameById.get(auditorId) ?? "")
          auditorsOf.set(agentId, list)
        }
      }
      return new Map(
        rows.map((row) => {
          const id = Number(row.id)
          const supervisorId = details.get(id)?.supervisorId ?? null
          const info: EmployeeInfo = {
            id,
            name: name(row),
            firstName: str(row.first_name),
            lastName: str(row.last_name),
            login: str(row.login),
            code: str(row.integration_code),
            position: str(row.position),
            branch: str(row.branch),
            active: Number(row.active) === 1,
            supervisor: supervisorId ? (nameById.get(supervisorId) ?? "") : "",
            auditors: (auditorsOf.get(id) ?? []).filter(Boolean).sort().join(" , "),
          }
          return [id, info] as const
        }),
      )
    })
  }

  /** Employees by lower-cased full name (documents keep the name of their agent, deliverer, author). */
  employeesByName(): Promise<Map<string, EmployeeInfo>> {
    return this.once("employeesByName", async () => {
      const map = new Map<string, EmployeeInfo>()
      // The active card wins when two employees share a name.
      const list = [...(await this.employees()).values()].sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id)
      for (const employee of list) if (!map.has(key(employee.name))) map.set(key(employee.name), employee)
      return map
    })
  }

  /** Equipment kept at a client (Инвентарь): how many and their names, by client id. */
  gear(): Promise<Map<number, GearInfo>> {
    return this.once("gear", async () => {
      const rows = await this.rows(
        `SELECT client_id, COUNT(*)::int AS n, string_agg(NULLIF(btrim(inventory_type), ''), ', ' ORDER BY id) AS names
           FROM inventory_items
          WHERE client_id IS NOT NULL AND COALESCE((to_jsonb(inventory_items) ->> 'deleted')::int, 0) = 0
          GROUP BY client_id`,
      ).catch(() => [])
      return new Map(rows.map((row) => [Number(row.client_id), { count: Number(row.n) || 0, names: str(row.names) }]))
    })
  }

  /** Warehouse name (lower-cased) → its branch. */
  warehouseBranches(): Promise<Map<string, string>> {
    return this.once("warehouseBranches", async () => {
      const rows = await this.rows("SELECT name, branch FROM warehouses")
      return new Map(rows.map((row) => [key(row.name), str(row.branch)]))
    })
  }

  /** Transport by its number (lower-cased): model and driver. */
  transports(): Promise<Map<string, { model: string; number: string; driver: string }>> {
    return this.once("transports", async () => {
      const rows = await this.rows("SELECT model, number, driver FROM transports").catch(() => [])
      return new Map(rows.map((row) => [key(row.number), { model: str(row.model), number: str(row.number), driver: str(row.driver) }]))
    })
  }

  /** Price of a product in a price list: "<price list>\u0001<product name>" (lower-cased) → cash price. */
  priceListPrices(): Promise<Map<string, number>> {
    return this.once("priceListPrices", async () => {
      const rows = await this.rows("SELECT price_list, product, cash FROM price_list_entries").catch(() => [])
      return new Map(rows.map((row) => [`${key(row.price_list)}\u0001${key(row.product)}`, Number(row.cash) || 0]))
    })
  }

  /** The client attributes the reports list as groupings (Настройки → Атрибуты клиентов with a report slot). */
  reportAttributes(): Promise<string[]> {
    return this.once("reportAttributes", async () => {
      const rows = await this.rows("SELECT name FROM client_attributes WHERE market_cache_number IS NOT NULL ORDER BY market_cache_number, id").catch(() => [])
      return rows.map((row) => str(row.name)).filter(Boolean)
    })
  }
}

export const nameKey = key
