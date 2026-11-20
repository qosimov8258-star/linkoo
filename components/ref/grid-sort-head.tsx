"use client"

// A sortable column title of Linko's GridList header: a button that keeps 30 px free on the right, where the 24 × 15
// arrow sits 10 px from the button's top (↓ ascending, ↑ descending); a click asks for the next ordering (Linko's
// sortingURL: field, then -field, then dropped; see toggleOrdering in components/analytics/list-url-state.tsx).

const ARROW_DOWN = "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"
const ARROW_UP = "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"

export function GridSortHead({ label, field, ordering, onSort, className = "" }: { label: string; field: string; ordering: string[]; onSort: (field: string) => void; className?: string }) {
  const dir = ordering.includes(field) ? "asc" : ordering.includes(`-${field}`) ? "desc" : null
  return (
    <button type="button" onClick={() => onSort(field)} className={`relative inline-flex min-h-[36px] items-center pr-[30px] text-left font-semibold leading-[18px] text-white ${className}`}>
      {label}
      {dir && (
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[10px] h-[15px] w-6 fill-white" aria-hidden>
          <path d={dir === "asc" ? ARROW_DOWN : ARROW_UP} />
        </svg>
      )}
    </button>
  )
}
