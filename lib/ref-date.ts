const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "08 июня 2026" — the reference app's short date (moment "DD MMM YYYY" in Russian). */
export function refDate(value: Date | string | number | null | undefined): string {
  if (value == null || value === "") return ""
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? value.replace(" ", "T") : value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** "30 апр. 2026, 03:22" — same, with the time. */
export function refDateTime(value: Date | string | number | null | undefined): string {
  const day = refDate(value)
  if (!day) return ""
  const date = value instanceof Date ? value : new Date(typeof value === "string" ? (value as string).replace(" ", "T") : (value as number))
  return `${day}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

const GENITIVE_TO_SHORT: Record<string, string> = {
  января: "янв.", февраля: "февр.", марта: "мар.", апреля: "апр.", мая: "мая", июня: "июня",
  июля: "июля", августа: "авг.", сентября: "сент.", октября: "окт.", ноября: "нояб.", декабря: "дек.",
}

/** "23 октября 2026" -> "23 окт. 2026": the reference lists print moment's short Russian months (DD MMM YYYY). */
export function shortRuDate(value: string): string {
  return value.replace(/(\d{1,2}) (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?= \d{4})/g, (_, day: string, month: string) => `${day} ${GENITIVE_TO_SHORT[month]}`)
}
