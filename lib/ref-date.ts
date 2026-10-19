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
