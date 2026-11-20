// Pure formulas of "Рекомендованный запас" (demo #/recommended-stock, chunk
// c138 / API stock/recommended_balances). No imports, so a node script can
// test them directly. The demo front end only displays the server's numbers;
// the formulas below reproduce them cell for cell (2026-11-20, four periods):
//   sale_part = sold ÷ Σ sold × 100 (3 decimals), by_day = sold ÷ days with sales,
//   remain_days = round(available ÷ by_day) (Python's, half to even), week / month = by_day × 6 / × 30 (2 decimals),
// e.g. 178 sold on 7 days, 1 139,1 available → by_day 25,4286, 45 days, 152,57 / 762,86.

export type RecommendedInput = {
  key: string
  /** Units sold in the period (−Σ order movements). */
  sold: number
  /** Distinct days of the period with sales of the item. */
  saleDays: number
  /** Available now (on hand − reserved − defects). */
  available: number
}

export type RecommendedNumbers = {
  sold: number
  /** Доля от продаж, % of the period's total sold (of the listed items), 3 decimals. */
  salePart: number
  available: number
  /** Сред. дневные продажи = sold ÷ days with sales. */
  byDay: number
  /** Запас дней = available ÷ by_day, rounded to a whole day (0 when nothing is available). */
  remainDays: number
  /** Рек. запас на 6 дней = by_day × 6 (2 decimals). */
  week: number
  /** Рек. запас на 30 дней = by_day × 30 (2 decimals). */
  month: number
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Python's round() (Linko's server): a half goes to the even neighbour (180,5 → 180, 1,5 → 2). */
function roundHalfEven(value: number): number {
  const clean = round(value, 6)
  const floor = Math.floor(clean)
  const rest = round(clean - floor, 6)
  if (rest > 0.5) return floor + 1
  if (rest < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** Numbers per item; only items with sales (sold > 0) are returned. */
export function recommendedNumbers(inputs: RecommendedInput[]): Map<string, RecommendedNumbers> {
  const selling = inputs.filter((input) => input.sold > 0)
  const totalSold = selling.reduce((sum, input) => sum + input.sold, 0)
  const result = new Map<string, RecommendedNumbers>()
  for (const input of selling) {
    const byDay = input.saleDays > 0 ? input.sold / input.saleDays : input.sold
    const available = round(input.available, 6)
    result.set(input.key, {
      sold: round(input.sold, 6),
      salePart: totalSold > 0 ? round((input.sold / totalSold) * 100, 3) : 0,
      available,
      byDay: round(byDay, 6),
      remainDays: byDay > 0 && available > 0 ? roundHalfEven(available / byDay) : 0,
      week: round(byDay * 6, 2),
      month: round(byDay * 30, 2),
    })
  }
  return result
}

/** "Показать по типу ед." (Linko select_type): every quantity × `factor` — the kg of a unit (Вес), its «Объем», or
 * 1 ÷ the units of its box (Блок; ×1 for an item without a box) — with by_day, week and month from the converted sold;
 * the share is taken again over the converted totals (`totalConverted`); Запас дней is a ratio and stays. */
export function convertRecommended(numbers: RecommendedNumbers, factor: number, saleDays: number, totalConverted: number): RecommendedNumbers {
  if (factor === 1 && totalConverted <= 0) return numbers
  const sold = numbers.sold * factor
  const byDay = saleDays > 0 ? sold / saleDays : sold
  return {
    ...numbers,
    sold: round(sold, 6),
    salePart: totalConverted > 0 ? round((sold / totalConverted) * 100, 3) : 0,
    available: round(numbers.available * factor, 6),
    byDay: round(byDay, 6),
    remainDays: factor ? numbers.remainDays : 0,
    week: round(byDay * 6, 2),
    month: round(byDay * 30, 2),
  }
}

/** Leading number of a free-text measure ("0,25 кг.", "1.5 м³", "Не указано м³." → 0). */
export function parseMeasure(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const match = /-?\d+(?:[.,]\d+)?/.exec(String(value ?? ""))
  return match ? Number(match[0].replace(",", ".")) || 0 : 0
}

/** Demo default period: the 1st of the month two months back … the end of the month of `today` (YYYY-MM-DD). */
export function defaultRecommendedPeriod(today: string): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number)
  const from = new Date(Date.UTC(year, month - 3, 1)).toISOString().slice(0, 10)
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return { from, to }
}
