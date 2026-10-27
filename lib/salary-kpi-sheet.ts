import { utils } from "xlsx"

export type KpiSheetRecord = {
  userId: number
  name: string
  firstName: string
  secondName: string
  salary: number
  indicators: Array<{ name: string; plan: number }>
}

export type KpiSheetStats = {
  columns: string[]
  rows: Record<number, { workDays: number | null; workedDays: number | null; facts: Record<string, Array<number | null>> }>
}

type Cell = string | number | null | { formula: string; value: number }

/** Text compares without spaces, punctuation and case, code point by code point (the order of the reference's employee lists). */
function plain(value: string) {
  return value.toLowerCase().replace(/[^0-9a-zа-яё]/g, "")
}

/** The reference sorts the employees by first name, then by second name. */
function nameOrder(a: KpiSheetRecord, b: KpiSheetRecord) {
  const first = [plain(a.firstName), plain(b.firstName)]
  if (first[0] !== first[1]) return first[0] < first[1] ? -1 : 1
  const second = [plain(a.secondName), plain(b.secondName)]
  return second[0] < second[1] ? -1 : second[0] > second[1] ? 1 : 0
}

/**
 * The "Скачать EXCEL" sheet of "Зарплата и установка планов": row 1 = fixed columns and one merged KPI name per 7 columns, row 2 =
 * План / Продажа / Возврат / Факт / % выполнения / Уровень / Сумма Бонуса, then one row per employee (sorted by name) and the
 * "Итого" row of SUM formulas, exactly as the reference's staff_balance/stat_excel sheet.
 */
export function buildKpiSheet(records: KpiSheetRecord[], stats: KpiSheetStats, t: (text: string) => string) {
  const kpis = stats.columns
  const sub = ["План", "Продажа", "Возврат", "Факт", "% выполнения", "Уровень", "Сумма Бонуса"].map((label) => t(label))
  const width = 6 + kpis.length * 7 + 1
  const head1: Cell[] = [t("№"), t("КПИ / Сотрудник"), t("Фиксированный оклад"), t("Рабочие дни"), t("Отработанные дни"), t("Зарплата")]
  const head2: Cell[] = ["", "", "", "", "", ""]
  for (const name of kpis) {
    head1.push(name, "", "", "", "", "", "")
    head2.push(...sub)
  }
  head1.push("")
  head2.push(t("Итоговая сумма"))

  const sorted = [...records].sort(nameOrder)
  const body = sorted.map((record, index) => {
    const stat = stats.rows[record.userId]
    const line: Cell[] = [index + 1, record.name, record.salary || "", stat?.workDays ?? 0, stat?.workedDays ?? 0, ""]
    for (const name of kpis) {
      const fact = stat?.facts[name]
      if (!fact) {
        line.push("", "", "", "", 0, "", "")
        continue
      }
      const plan = record.indicators.find((item) => item.name === name)?.plan ?? fact[0]
      line.push(plan ?? "", fact[1] ?? "", fact[2] ?? "", fact[3] ?? "", fact[4] ?? "", fact[5] ?? "", fact[6] ?? "")
    }
    line.push(0)
    return line
  })

  // "Итого": SUM of every numeric column, % = Факт * 100 / План (cached as 0, like the reference's file).
  const first = 3
  const last = 2 + body.length
  const col = (index: number) => utils.encode_col(index)
  const total: Cell[] = ["", t("Итого")]
  for (let c = 2; c < width; c += 1) {
    const kpiIndex = c - 6
    const inKpi = kpiIndex >= 0 && c < width - 1
    const offset = inKpi ? kpiIndex % 7 : -1
    if (c === 3 || offset === 5) total.push("")
    else if (offset === 4) total.push({ formula: `${col(c - 1)}${last + 1}*100/${col(c - 4)}${last + 1}`, value: 0 })
    else total.push({ formula: `SUM(${col(c)}${first}:${col(c)}${last})`, value: 0 })
  }

  const merges = ["A1:A2", "B1:B2", "C1:C2", "D1:D2", "E1:E2", "F1:F2"]
  for (let k = 0; k < kpis.length; k += 1) merges.push(`${col(6 + k * 7)}1:${col(12 + k * 7)}1`)
  const widths = Array.from({ length: Math.min(51, width) }, (_, index) => (index === 0 ? 4.71 : index < 5 ? 20.71 : 10.71))
  return { rows: [head1, head2, ...body, total], merges, widths }
}
