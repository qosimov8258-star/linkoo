/**
 * Header sorting of the reference's react-table reports (Визиты агента, Системная дистрибуция …).
 *
 * A click on a header cycles none → ascending → descending → none (Linko writes ordering=<key>, -<key>, then
 * drops it). The mark is two grey (#c0c0c0) triangles; a sorted column keeps only the triangle of its
 * direction (the other one turns transparent), so one arrow goes up, then down, one at a time.
 */

export type SortDir = "asc" | "desc"
export type SortState<K> = { key: K; dir: SortDir } | null

/** The next sort state after a click on the header `key`. */
export function nextSort<K>(current: SortState<K>, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, dir: "asc" }
  return current.dir === "asc" ? { key, dir: "desc" } : null
}

/** Orders a copy of `rows` by `value` in the state's direction (unchanged when nothing is sorted). */
export function sortBy<T, K>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => string | number | null | undefined): T[] {
  if (!sort) return rows
  const dir = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a, sort.key)
    const y = value(b, sort.key)
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir
    return String(x ?? "").localeCompare(String(y ?? ""), "ru", { numeric: true }) * dir
  })
}

const UP = "M7 14l5-5 5 5z"
const DOWN = "M7 10l5 5 5-5z"

export function SortArrows({ dir, color = "#c0c0c0", className = "" }: { dir?: SortDir | null; color?: string; className?: string }) {
  return (
    <span className={`ml-[2px] inline-flex h-5 w-5 shrink-0 flex-col items-center justify-center align-middle ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="-mb-[5px] h-[15px] w-[15px]" style={{ fill: dir === "desc" ? "transparent" : color }}>
        <path d={UP} />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" style={{ fill: dir === "asc" ? "transparent" : color }}>
        <path d={DOWN} />
      </svg>
    </span>
  )
}

/** nextSort for the `{ key: number | null; dir }` state of the ReportMatrix pages (key null = not sorted). */
export function nextMatrixSort(current: { key: number | null; dir: SortDir }, index: number): { key: number | null; dir: SortDir } {
  return nextSort(current.key === null ? null : { key: current.key, dir: current.dir }, index) ?? { key: null, dir: "asc" }
}
