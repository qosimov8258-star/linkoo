// Number rules of «Классификация и динамика клиентов», shared by the server (lib/client-classification-repo.ts) and
// the page (the two total rows are built in the browser from the class rows).

/** Python's round() (half to even), the reference backend's rounding of its percents: -87.5 → -88, 0.5 → 0. */
export function pyRound(value: number): number {
  const floor = Math.floor(value)
  if (Math.abs(value - floor - 0.5) > 1e-9) return Math.round(value)
  return floor % 2 === 0 ? floor : floor + 1
}

/** Linko's dynamic of a value against the previous period: the change in %, +100 when it starts from nothing. */
export function classificationDynamic(current: number, previous: number): number {
  if (previous > 0) return pyRound(((current - previous) / previous) * 100)
  return current > 0 ? 100 : 0
}
