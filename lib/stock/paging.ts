// Query-string paging shared by the stock list endpoints: a page number is a
// finite integer ≥ 1 (anything else — "abc", "-5", "1e309" = Infinity — falls
// back to 1) and is capped so OFFSET stays a sane integer.

export const MAX_PAGE = 1_000_000

/** `page` of a query string: 1 when missing or not a finite number ≥ 1, at most MAX_PAGE. */
export function parsePageParam(value: string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), MAX_PAGE) : 1
}
