import "server-only"

import { loadRateBook, type RateBook } from "@/lib/currency-rates-repo"
import type { PgDb } from "@/lib/db"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"

import { Directory } from "./directory"
import type { GroupDef, MeasureFn } from "./pivot"

// What a model of the old report builder gets to load its records with, and the shape of a model.

/** Money of the documents in the two currencies the reports print:
 * - `base`: the base currency (Валюты), at the rate of the document's moment — the reference's "основная валюта"
 *   ("ОВ", "…, SUM") columns; a currency without a rate gives 0 and is named in `missing`;
 * - `own`: the document's own currency, as the reference adds such columns up without converting them.
 * With an app currency (Настройки → Валюта приложения) both are in it, like everywhere in the app. */
export type Money = {
  /** Code of the currency the base amounts are in. */
  code: string
  base: (amount: number, currency: string | null | undefined, at: string | null | undefined) => number
  own: (amount: number, currency: string | null | undefined, at: string | null | undefined) => number
  /** The printed name of a document's currency (the «Валюта» grouping). */
  name: (currency: string | null | undefined) => string
  /** The factors of a document: `own` turns its stored amounts into the printed own-currency ones, `toBase` those
   * into the base currency (0 without a rate); `name` is the printed currency. */
  rate: (currency: string | null | undefined, at: string | null | undefined) => { own: number; toBase: number; name: string }
  missing: Set<string>
}

async function loadMoney(db: PgDb): Promise<Money> {
  const book: RateBook = await loadRateBook(db)
  const context = await loadCurrencyContext(db)
  const shown = baseReportCurrency(context)
  const app = context.work
  const missing = new Set<string>()
  const base = (amount: number, currency: string | null | undefined, at: string | null | undefined) => {
    if (!amount) return 0
    const code = normCurrency(String(currency ?? ""), book.base)
    const rate = book.rateAt(code, at ?? "")
    if (rate === null) {
      missing.add(code)
      return 0
    }
    return amount * rate * shown.factor
  }
  const name = (currency: string | null | undefined) => currencyLabel(app || normCurrency(String(currency ?? ""), book.base))
  return {
    code: shown.code,
    base,
    own: (amount, currency, at) => (app ? base(amount, currency, at) : amount),
    name,
    rate: (currency, at) => {
      const inBase = base(1, currency, at)
      const own = app ? inBase : 1
      return { own, toBase: own ? inBase / own : 0, name: name(currency) }
    },
    missing,
  }
}

export type RunContext = {
  db: PgDb
  schema: FinanceSchema
  /** The period: local business days, both included. */
  from: string
  to: string
  /** The branch chosen in the header ("" = every branch). */
  branch: string
  /** Field models: the employees the reader may see (undefined = everybody, [] = nobody). */
  employeeIds?: number[]
  dir: Directory
  money: Money
  /** Is one of these fields asked for (a column, a grouping or a filter)? Lets a model skip a costly lookup. */
  wants: (...ids: string[]) => boolean
}

export async function createRunContext(
  db: PgDb,
  input: { from: string; to: string; branch: string; employeeIds?: number[]; requested: Iterable<string> },
): Promise<RunContext> {
  const schema = await ensureFinanceSchema(db)
  const requested = new Set(input.requested)
  return {
    db,
    schema,
    from: input.from,
    to: input.to,
    branch: input.branch,
    employeeIds: input.employeeIds,
    dir: new Directory(db),
    money: await loadMoney(db),
    wants: (...ids) => ids.some((id) => requested.has(id)),
  }
}

/** What a filter's `value` answers for a record the filter does not apply to (the order's status for a line of a
 * return): the record passes whatever is chosen. */
export const PASS = Symbol("filter does not apply")

/** A quick filter (a multi-select of «Быстрый фильтр») or a comparison filter («Фильтры») of a model. */
export type FilterDef<R> = {
  /** The record's value(s) the chosen ones are compared with. */
  value: (record: R) => string | number | null | undefined | readonly (string | number)[] | typeof PASS
  /** Options of a quick filter; without it the page offers the values the period's records have. */
  options?: (context: RunContext) => Promise<string[]> | string[]
}

/** Who may read a model: everybody signed in; the field scope (visits, tasks, refusals: an agent sees their own);
 * the readers of purchases (supplier documents with their prices); the readers of company money. */
export type ModelAccess = "any" | "field" | "purchases" | "money"

export type ModelImpl<R> = {
  access: ModelAccess
  load: (context: RunContext) => Promise<R[]>
  /** By field id of the catalog (lib/old-report/catalog.ts). */
  groups: Record<string, GroupDef<R>>
  measures: Record<string, MeasureFn<R>>
  filters: Record<string, FilterDef<R>>
  /** Field ids that show what the goods cost (cost price, profit, markup): only for the readers of purchases. */
  cost?: readonly string[]
}

/** Lets a model file declare its implementation with its own record type. */
export const defineModel = <R>(model: ModelImpl<R>): ModelImpl<R> => model

export type AnyModel = ModelImpl<never>
