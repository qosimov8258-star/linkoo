export type PeriodKey = "СЕГОДНЯ" | "ВЧЕРА" | "ПОСЛ. 7" | "МЕСЯЦ" | "СВОЯ"

export const MONTHS_NOMINATIVE = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]

const MONTHS_ABBR = ["Янв.", "Февр.", "Мар.", "Апр.", "Мая", "Июня", "Июля", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return new Date()
  return new Date(y, m - 1, d)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function formatDateAbbr(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")} ${MONTHS_ABBR[date.getMonth()]} ${date.getFullYear()}`
}

function formatDateGenitive(date: Date): string {
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`
}

export function formatRangeLabel(begin: Date, end: Date): string {
  if (toISODate(begin) === toISODate(end)) return formatDateAbbr(begin)
  return `${formatDateAbbr(begin)} - ${formatDateAbbr(end)}`
}

export function formatStatTitle(prefix: string, begin: Date, end: Date): string {
  if (toISODate(begin) === toISODate(end)) return `${prefix} на ${formatDateGenitive(begin)}`
  return `${prefix} с ${formatDateGenitive(begin)} по ${formatDateGenitive(end)}`
}

export function rangeForPeriod(
  period: PeriodKey,
  today: Date,
  custom: { begin: Date; end: Date },
): { begin: Date; end: Date } {
  switch (period) {
    case "СЕГОДНЯ":
      return { begin: today, end: today }
    case "ВЧЕРА": {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { begin: yesterday, end: yesterday }
    }
    case "ПОСЛ. 7": {
      const start = new Date(today)
      start.setDate(start.getDate() - 7)
      return { begin: start, end: today }
    }
    case "МЕСЯЦ":
      return { begin: startOfMonth(today), end: endOfMonth(today) }
    case "СВОЯ":
    default:
      return custom
  }
}
