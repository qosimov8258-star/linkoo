export type WriteOffItem = { id: number; product: string; code: string; series: string; block: number; qty: number; cost: number; sum: number }
export type WriteOff = { id: number; creator: string; warehouse: string; date: string; status: "закрыт" | "открыт"; comment: string; reason: string; items: WriteOffItem[] }

export const writeOffWarehouses = ["05,08,2025(1)", "Andijon skladi", "toshkent", "Suhrob sklad", "основной"]
export const writeOffReasons = ["Порча", "Истек срок годности", "Недостача", "Брак", "Прочее"]
export const writeOffProducts = ["Muzlatkich 2", "sndwch", "g'ilof", "robot moshina", "energetik 1 l", "coca-cola"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownRows: Omit<WriteOff, "items" | "comment" | "reason">[] = [
  { id: 69, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "24 июня 2026", status: "закрыт" },
  { id: 68, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "11 апр. 2026", status: "закрыт" },
  { id: 67, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "16 мар. 2026", status: "закрыт" },
  { id: 66, creator: "Admin Ritm", warehouse: "Andijon skladi", date: "06 февр. 2026", status: "закрыт" },
  { id: 65, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "05 февр. 2026", status: "закрыт" },
]

function buildRows(): WriteOff[] {
  const rows: WriteOff[] = knownRows.map((row) => ({
    ...row,
    comment: "",
    reason: writeOffReasons[row.id % writeOffReasons.length],
    items:
      row.id === 67
        ? [{ id: 1, product: "Muzlatkich 2", code: "-", series: "-", block: 0, qty: 10, cost: 51176.499, sum: 511764.994 }]
        : [{ id: 1, product: writeOffProducts[row.id % writeOffProducts.length], code: "-", series: "-", block: 0, qty: 1 + (row.id % 15), cost: 1000 + (row.id * 373) % 90000, sum: 0 }],
  }))
  rows.forEach((row) => {
    if (row.id !== 67) row.items[0].sum = row.items[0].qty * row.items[0].cost
  })

  const baseline = new Date(2026, 1, 5)
  for (let id = 64; id >= 5; id -= 1) {
    const offsetDays = (65 - id) * 6
    const date = new Date(baseline)
    date.setDate(date.getDate() - offsetDays)
    const qty = 1 + (id % 15)
    const cost = 1000 + (id * 373) % 90000
    rows.push({
      id,
      creator: "Admin Ritm",
      warehouse: writeOffWarehouses[id % writeOffWarehouses.length],
      date: fmt(date),
      status: "закрыт",
      comment: "",
      reason: writeOffReasons[id % writeOffReasons.length],
      items: [{ id: 1, product: writeOffProducts[id % writeOffProducts.length], code: "-", series: "-", block: 0, qty, cost, sum: qty * cost }],
    })
  }

  return rows
}

export const seedWriteOffs: WriteOff[] = buildRows()
