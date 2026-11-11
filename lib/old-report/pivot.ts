import "server-only"

import type { BuilderResult } from "@/lib/report-builder-repo"

// The table of the old report builder (Конструктор отчетов): records of a model are split into rows by the vertical
// groupings and into column groups by the horizontal ones, and every chosen measure is computed over the records of
// a cell. The totals (the bottom row, the right column, their corner) are computed over their own records, not added
// up from the cells, so a distinct count or an average stays right. The result has the shape of the new builder's
// (lib/report-builder-repo.ts BuilderResult), so the same table, chart and Excel export print it.

export type GroupValue = string | number | null | undefined

/** A grouping: the printed value of a record ("" prints as «Не указано») and, when the print order differs from the
 * order of the labels (a date printed as 07.01.2026), the key to sort by. */
export type GroupDef<R> = {
  label: (record: R) => GroupValue
  sort?: (record: R) => GroupValue
}

/** A measure: its value over the records of one cell (an empty list for a cell without records). */
export type MeasureFn<R> = (records: readonly R[]) => number | string

export type PivotSpec<R> = {
  records: readonly R[]
  vertical: { name: string; def: GroupDef<R> }[]
  horizontal: { name: string; def: GroupDef<R> }[]
  columns: { name: string; fn: MeasureFn<R> }[]
  showTotals: boolean
}

/** The name of an empty grouping value, as the reference prints it. */
export const NOT_SET = "Не указано"
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/

/** The reference's order (pandas): numbers by value, texts by their characters (Latin before Cyrillic). */
function compareLabel(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Number(a.replace(",", ".")) - Number(b.replace(",", "."))
  return a < b ? -1 : a > b ? 1 : 0
}
function compareKeys(a: string[], b: string[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const order = compareLabel(a[index] ?? "", b[index] ?? "")
    if (order) return order
  }
  return 0
}

const text = (value: GroupValue) => (value === null || value === undefined ? "" : String(value).trim())

export function pivot<R>(spec: PivotSpec<R>): BuilderResult {
  const { records, vertical, horizontal, columns } = spec
  const label = (def: GroupDef<R>, record: R) => text(def.label(record)) || NOT_SET
  const sortKey = (def: GroupDef<R>, record: R, shown: string) => (def.sort ? text(def.sort(record)) || shown : shown)

  type Row = { labels: string[]; sort: string[]; cells: Map<string, R[]>; all: R[] }
  const rowsMap = new Map<string, Row>()
  const colSort = new Map<string, string[]>()
  const colRecords = new Map<string, R[]>()
  for (const record of records) {
    const rowLabels = vertical.map((group) => label(group.def, record))
    const colLabels = horizontal.map((group) => label(group.def, record))
    const rowKey = rowLabels.join("\u0001")
    const colKey = colLabels.join(" / ")
    if (!colSort.has(colKey)) colSort.set(colKey, horizontal.map((group, index) => sortKey(group.def, record, colLabels[index])))
    let row = rowsMap.get(rowKey)
    if (!row) {
      row = { labels: rowLabels, sort: vertical.map((group, index) => sortKey(group.def, record, rowLabels[index])), cells: new Map(), all: [] }
      rowsMap.set(rowKey, row)
    }
    const cell = row.cells.get(colKey)
    if (cell) cell.push(record)
    else row.cells.set(colKey, [record])
    row.all.push(record)
    const column = colRecords.get(colKey)
    if (column) column.push(record)
    else colRecords.set(colKey, [record])
  }

  const none: R[] = []
  const colKeys = [...colSort.keys()].sort((a, b) => compareKeys(colSort.get(a) ?? [], colSort.get(b) ?? []))
  const sorted = [...rowsMap.values()].sort((a, b) => compareKeys(a.sort, b.sort))
  const measures = (list: readonly R[]) => columns.map((column) => column.fn(list))
  const names = columns.map((column) => column.name)
  const result: BuilderResult = {
    headers: [...vertical.map((group) => group.name), ...colKeys.flatMap((key) => names.map((name) => (horizontal.length && key ? `${key} · ${name}` : name)))],
    rows: sorted.map((row) => [...row.labels, ...colKeys.flatMap((key) => measures(row.cells.get(key) ?? none))]),
    totals: spec.showTotals ? [...vertical.map((_, index) => (index === 0 ? "Итого" : "")), ...colKeys.flatMap((key) => measures(colRecords.get(key) ?? none))] : null,
    unsupported: [],
    count: records.length,
    vertical: vertical.map((group) => group.name),
    keys: colKeys,
    columns: names,
  }
  if (horizontal.length) {
    result.rowTotals = sorted.map((row) => measures(row.all))
    result.grandTotals = measures(records)
  }
  return result
}

// ---------------------------------------------------------------- measure helpers

export const round = (value: number, digits = 3) => {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

type Num<R> = (record: R) => number | null | undefined
type Key<R> = (record: R) => string | number | null | undefined

/** SUM(value); money sums pass `digits` = 2. */
export const sum =
  <R>(value: Num<R>, digits = 3): MeasureFn<R> =>
  (records) => {
    let total = 0
    for (const record of records) total += value(record) || 0
    return round(total, digits)
  }

/** COUNT(*) of the records, or of the ones `when` accepts. */
export const count =
  <R>(when?: (record: R) => boolean): MeasureFn<R> =>
  (records) => {
    if (!when) return records.length
    let total = 0
    for (const record of records) if (when(record)) total++
    return total
  }

/** COUNT(DISTINCT key); records whose key is null / "" are left out. */
export const distinct =
  <R>(key: Key<R>): MeasureFn<R> =>
  (records) => {
    const seen = new Set<string | number>()
    for (const record of records) {
      const value = key(record)
      if (value !== null && value !== undefined && value !== "") seen.add(value)
    }
    return seen.size
  }

/** AVG(value) over the records that have one. */
export const avg =
  <R>(value: Num<R>, digits = 3): MeasureFn<R> =>
  (records) => {
    let total = 0
    let n = 0
    for (const record of records) {
      const item = value(record)
      if (item === null || item === undefined || !Number.isFinite(item)) continue
      total += item
      n++
    }
    return n ? round(total / n, digits) : 0
  }

const extreme =
  <R>(value: Num<R>, better: (a: number, b: number) => boolean, digits: number): MeasureFn<R> =>
  (records) => {
    let found: number | null = null
    for (const record of records) {
      const item = value(record)
      if (item === null || item === undefined || !Number.isFinite(item)) continue
      if (found === null || better(item, found)) found = item
    }
    return found === null ? 0 : round(found, digits)
  }
export const min = <R>(value: Num<R>, digits = 3) => extreme(value, (a, b) => a < b, digits)
export const max = <R>(value: Num<R>, digits = 3) => extreme(value, (a, b) => a > b, digits)

/** The smallest / largest text of the records (ISO days and times compare as texts), printed through `print`. */
const extremeText =
  <R>(value: (record: R) => string | null | undefined, better: (a: string, b: string) => boolean, print: (value: string) => string): MeasureFn<R> =>
  (records) => {
    let found = ""
    for (const record of records) {
      const item = value(record)
      if (!item) continue
      if (!found || better(item, found)) found = item
    }
    return found ? print(found) : ""
  }
export const minText = <R>(value: (record: R) => string | null | undefined, print: (value: string) => string = (item) => item) => extremeText(value, (a, b) => a < b, print)
export const maxText = <R>(value: (record: R) => string | null | undefined, print: (value: string) => string = (item) => item) => extremeText(value, (a, b) => a > b, print)

/** A value that belongs to an entity, not to a record (the shops of an agent, the units in a block of a product):
 * each entity of the cell counts once — SUM(value) over the distinct keys. Grouped by the entity it is its value. */
export const perKey =
  <R>(key: Key<R>, value: Num<R>, digits = 3): MeasureFn<R> =>
  (records) => {
    const seen = new Set<string | number>()
    let total = 0
    for (const record of records) {
      const id = key(record)
      if (id === null || id === undefined || id === "" || seen.has(id)) continue
      seen.add(id)
      total += value(record) || 0
    }
    return round(total, digits)
  }

/** The text of the latest record by `order` (the comment of the last refusal). */
export const lastText =
  <R>(order: (record: R) => string | null | undefined, value: (record: R) => string | null | undefined): MeasureFn<R> =>
  (records) => {
    let best = ""
    let found = ""
    for (const record of records) {
      const at = order(record)
      if (!at || at < best) continue
      best = at
      found = value(record) ?? ""
    }
    return found
  }

// ---------------------------------------------------------------- label helpers

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

/** "2026-01-07" → "07.01.2026" ("" for no day). */
export const dmy = (iso: string | null | undefined) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "")
/** "2026-01-07T09:15:00" → "07.01.2026 09:15". */
export const dmyTime = (iso: string | null | undefined) => (iso && iso.length >= 16 ? `${dmy(iso)} ${iso.slice(11, 16)}` : dmy(iso))
/** "2026-01-07T09:15:42" → "09:15:42". */
export const clock = (iso: string | null | undefined) => (iso && iso.length >= 19 ? iso.slice(11, 19) : "")

function weekStart(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date
}
const isoOf = (date: Date) => date.toISOString().slice(0, 10)

/** The groupings of a day: by day, week ("05.01.2026 - 11.01.2026"), month ("Январь 2026") and year. */
export function dayGroups<R>(day: (record: R) => string | null | undefined) {
  const of = (record: R) => {
    const value = day(record)
    return value && value.length >= 10 ? value.slice(0, 10) : ""
  }
  const byDay: GroupDef<R> = { label: (record) => dmy(of(record)), sort: of }
  const byWeek: GroupDef<R> = {
    label: (record) => {
      const value = of(record)
      if (!value) return ""
      const start = weekStart(value)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 6)
      return `${dmy(isoOf(start))} - ${dmy(isoOf(end))}`
    },
    sort: (record) => (of(record) ? isoOf(weekStart(of(record))) : ""),
  }
  const byMonth: GroupDef<R> = {
    label: (record) => {
      const value = of(record)
      return value ? `${MONTHS[Number(value.slice(5, 7)) - 1] ?? value.slice(5, 7)} ${value.slice(0, 4)}` : ""
    },
    sort: (record) => of(record).slice(0, 7),
  }
  const byYear: GroupDef<R> = { label: (record) => of(record).slice(0, 4) }
  return { byDay, byWeek, byMonth, byYear }
}

/** A number printed as the reference prints a grouping value: no trailing zeros ("1200", "0.89"). */
export const plain = (value: number | null | undefined, digits = 3) => (value === null || value === undefined || !Number.isFinite(value) ? "" : String(round(value, digits)))
export const yesNo = (value: unknown) => (value ? "Да" : "Нет")
