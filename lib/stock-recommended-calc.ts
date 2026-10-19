// Pure formulas of "Рекомендованный запас" (demo #/recommended-stock, chunk
// c138 / API stock/recommended_balances). No imports, so a node script can
// test them directly. The demo front end only displays the server's numbers;
// the formulas below reproduce its sample
//   {total_amount: 5, by_day: 1.6667, total_balance: 5210, remain_days: 3126,
//    week_recommendations: 10, month_recommendations: 50, sale_part: 100}
// with 5 units sold on 3 distinct days.

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
  /** Доля от продаж, % of the period's total sold (of the listed items). */
  salePart: number
  available: number
  /** Сред. дневные продажи = sold ÷ days with sales. */
  byDay: number
  /** Запас дней = available ÷ by_day (0 when nothing is available). */
  remainDays: number
  /** Рек. запас на 6 дней = ⌈by_day × 6⌉. */
  week: number
  /** Рек. запас на 30 дней = ⌈by_day × 30⌉. */
  month: number
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** ⌈x⌉ without float noise (1.6666…7 × 6 = 10.000000000000002 → 10). */
const ceilClean = (value: number) => Math.ceil(round(value, 6))

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
      salePart: totalSold > 0 ? round((input.sold / totalSold) * 100, 2) : 0,
      available,
      byDay: round(byDay, 4),
      remainDays: byDay > 0 && available > 0 ? round(available / byDay, 2) : 0,
      week: ceilClean(byDay * 6),
      month: ceilClean(byDay * 30),
    })
  }
  return result
}

/** "Показать по типу ед.": Количество (×1), Вес (× kg per unit), Объем (× m³ per unit).
 * Shares and days are ratios and do not change. */
export function convertRecommended(numbers: RecommendedNumbers, factor: number): RecommendedNumbers {
  if (factor === 1) return numbers
  return {
    ...numbers,
    sold: round(numbers.sold * factor, 4),
    available: round(numbers.available * factor, 4),
    byDay: round(numbers.byDay * factor, 4),
    week: round(numbers.week * factor, 4),
    month: round(numbers.month * factor, 4),
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
