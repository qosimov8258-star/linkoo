const LONG_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** Field format of the reference date pickers: "22 октября 2026 г." (input "YYYY-MM-DD"). */
export function formatLongDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${Number(match[3])} ${LONG_MONTHS[Number(match[2]) - 1]} ${match[1]} г.` : value
}
