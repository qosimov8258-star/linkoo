// Row helpers shared by the finance server code and the balance UI.

import type { BalanceRow } from "@/lib/finance/types"

/** Sorts rows in place by ordering keys: "name", "info.<field>", "<field>.<CUR>"
 * (one currency) or "<field>" (sum over currencies); "-" prefix = descending.
 * Same semantics as the `ordering` param of GET /api/balances/{kind}. */
export function sortBalanceRows<R extends BalanceRow>(rows: R[], ordering: string[] | undefined): R[] {
  const keys = (ordering ?? []).filter(Boolean)
  if (!keys.length) return rows
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  const getters = keys.map((raw) => {
    const desc = raw.startsWith("-")
    const key = desc ? raw.slice(1) : raw
    let get: (row: R) => string | number
    if (key === "name") get = (row) => row.name
    else if (key.startsWith("info.")) get = (row) => row.info[key.slice(5)] ?? ""
    else {
      const [field, code] = key.split(".")
      get = (row) => (code ? (row.currencies[code]?.[field] ?? 0) : Object.values(row.currencies).reduce((sum, balance) => sum + (balance[field] ?? 0), 0))
    }
    return { desc, get }
  })
  return rows.sort((a, b) => {
    for (const { desc, get } of getters) {
      const left = get(a)
      const right = get(b)
      const cmp = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right))
      if (cmp !== 0) return desc ? -cmp : cmp
    }
    return 0
  })
}
