"use client"

import { FormEvent, useMemo, useState } from "react"
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Expand,
  Filter,
  List,
  Pencil,
  Search,
  Star,
  X,
} from "lucide-react"

type EquipmentRow = {
  client: string
  equipment: string
  branch: string
  inventoryType: string
}

const equipmentRows: EquipmentRow[] = [
  { client: "Pepsi Market", equipment: "Холодильник (2 шт.)", branch: "777", inventoryType: "Холодильник" },
  { client: "test 2", equipment: "Холодильник (1 шт.)", branch: "878", inventoryType: "Холодильник" },
  { client: "Тест один", equipment: "Холодильник (1 шт.)", branch: "agent", inventoryType: "Холодильник" },
  { client: "Одил бобо лимонадный", equipment: "Холодильник (1 шт.)", branch: "Andijon", inventoryType: "Холодильник" },
  { client: "Окошко сано хола", equipment: "Texnik apparat (1 шт.)", branch: "Andijon", inventoryType: "Техническое оборудование" },
  { client: "Turizm police", equipment: "Холодильник (1 шт.)", branch: "AURUM samarqand", inventoryType: "Холодильник" },
  { client: "o'n to'rtinchi klient", equipment: "g'ilof (1 шт.)", branch: "777", inventoryType: "Другое" },
  { client: "Xorazm o'n sakkizinchi klient", equipment: "Холодильник (1 шт.)", branch: "878", inventoryType: "Холодильник" },
  { client: "Xorazm qirq beshinchi klient", equipment: "Холодильник (1 шт.)", branch: "agent", inventoryType: "Холодильник" },
  { client: "yangi mijoz", equipment: "Muzlatkich 2 (1 шт.), sprayt (1 шт.), Холодильник (1 шт.)", branch: "Andijon", inventoryType: "Холодильник" },
  { client: "dhdbdb", equipment: "bagaj (1 шт.), shkaf (1 шт.)", branch: "Andijon", inventoryType: "Другое" },
  { client: "Клиент #1", equipment: "g'ilof (1 шт.)", branch: "777", inventoryType: "Другое" },
  { client: "teat", equipment: "Muzlatkich 2 (1 шт.)", branch: "878", inventoryType: "Морозильник" },
  { client: "client shablon 1", equipment: "Muzlatkich 2 (1 шт.)", branch: "agent", inventoryType: "Морозильник" },
  { client: "client shablon 2", equipment: "lipton (1 шт.)", branch: "Andijon", inventoryType: "Другое" },
  { client: "ТЕСТОВЫЙ КЛИЕНТ 10", equipment: "test inventar (1 шт.)", branch: "AURUM samarqand", inventoryType: "Другое" },
  { client: "Pardachi Abbos", equipment: "Холодильник (1 шт.)", branch: "777", inventoryType: "Холодильник" },
  { client: "Javohir qoratosh", equipment: "coca-cola (1 шт.)", branch: "878", inventoryType: "Другое" },
]

const selectOptions = {
  organization: ["Все организации", "Linko", "Time3 Distribution"],
  zone: ["Все зоны", "Arslan", "spark", "Andijon shaharchasi"],
  agent: ["Все клиенты агента", "Admin Ritm", "Samandar Abdurahmonov"],
  branch: ["Все филиалы", "777", "878", "agent", "Andijon", "AURUM samarqand"],
  inventory: ["Весь инвентарь", "Холодильник", "Muzlatkich 2", "Texnik apparat"],
  inventoryType: ["Все типы инвентаря", "Холодильник", "Морозильник", "Техническое оборудование", "Другое"],
  clientType: ["Все типы клиентов", "horeca", "market", "market100"],
  productType: ["Все типы товаров", "Напитки", "Снеки", "Бытовая химия"],
  product: ["Все товары", "coca-cola", "lipton", "sprayt"],
}

type Filters = {
  organization: string
  zone: string
  agent: string
  branch: string
  inventory: string
  inventoryType: string
  clientType: string
  productType: string
  product: string
  saleFrom: string
  saleTo: string
  equipmentSaleFrom: string
  equipmentSaleTo: string
}

const emptyFilters: Filters = {
  organization: selectOptions.organization[0],
  zone: selectOptions.zone[0],
  agent: selectOptions.agent[0],
  branch: selectOptions.branch[0],
  inventory: selectOptions.inventory[0],
  inventoryType: selectOptions.inventoryType[0],
  clientType: selectOptions.clientType[0],
  productType: selectOptions.productType[0],
  product: selectOptions.product[0],
  saleFrom: "",
  saleTo: "",
  equipmentSaleFrom: "",
  equipmentSaleTo: "",
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-900">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full border-0 border-b border-slate-300 bg-transparent px-0 text-base outline-none focus:border-blue-500"
      >
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full border-0 border-b border-slate-300 bg-transparent outline-none focus:border-blue-500"
      />
    </label>
  )
}

export function EquipmentEfficiencyView() {
  const [favorite, setFavorite] = useState(false)
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [fullscreen, setFullscreen] = useState(false)

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    return equipmentRows.filter((row) => {
      if (normalized && !`${row.client} ${row.equipment}`.toLocaleLowerCase("ru").includes(normalized)) return false
      if (filters.branch !== selectOptions.branch[0] && row.branch !== filters.branch) return false
      if (filters.inventoryType !== selectOptions.inventoryType[0] && row.inventoryType !== filters.inventoryType) return false
      if (filters.inventory !== selectOptions.inventory[0] && !row.equipment.includes(filters.inventory)) return false
      if (filters.product !== selectOptions.product[0] && !row.equipment.toLowerCase().includes(filters.product.toLowerCase())) return false
      return true
    })
  }, [query, filters])

  function updateFilter<Key extends keyof Filters>(key: Key, value: Filters[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    setFilters(draft)
    setFilterOpen(false)
  }

  function downloadExcel() {
    const header = ["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"]
    const escapeHtml = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    const tableRows = [
      `<tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>`,
      ...rows.map((row) =>
        `<tr>${[row.client, "0 SUM", "0 SUM", "0 SUM", "0 SUM", row.equipment]
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
      ),
    ].join("")
    const workbook = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Оборудование</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>table{border-collapse:collapse;font-family:Arial}th{background:#dce6f1;font-weight:bold}th,td{border:1px solid #999;padding:8px;white-space:nowrap}</style></head><body><table>${tableRows}</table></body></html>`
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([`\uFEFF${workbook}`], { type: "application/vnd.ms-excel;charset=utf-8" }))
    link.download = "equipment-efficiency.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className={fullscreen ? "fixed inset-0 z-50 overflow-auto bg-slate-100" : "min-h-[calc(100vh-64px)] bg-slate-100"}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-slate-100 px-6 py-4">
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3 text-left">
          <Star className={`h-7 w-7 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />
          <span className="text-2xl font-semibold text-blue-600">Избранные</span>
          <span className="text-2xl text-slate-500">|</span>
          <span className="text-2xl font-semibold text-slate-600">Эффективность оборудования</span>
        </button>
        <div className="flex rounded-md bg-white shadow">
          <button onClick={() => setMode("created")} className={`rounded-md px-6 py-3 ${mode === "created" ? "bg-emerald-400 text-white shadow" : ""}`}>ПО ДАТЕ СОЗДАНИЕ</button>
          <button onClick={() => setMode("realized")} className={`rounded-md px-6 py-3 ${mode === "realized" ? "bg-emerald-400 text-white shadow" : ""}`}>ПО ДАТЕ РЕАЛИЗАЦИИ</button>
        </div>
      </header>

      <section className="bg-white px-6 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setFilterOpen(true)} className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-3 font-semibold text-white">
              <Filter className="h-5 w-5" /> Фильтр
            </button>
            <span className="font-medium text-blue-600">{filters.organization === selectOptions.organization[0] ? "Во всей организации" : filters.organization}</span>
          </div>
          <button onClick={downloadExcel} className="flex items-center gap-2 rounded-md bg-emerald-400 px-5 py-3 font-semibold text-white">
            <BarChart3 className="h-5 w-5" /> Скачать Excel
          </button>
        </div>

        <div className="grid border md:grid-cols-4">
          <div className="space-y-3 border-r p-4">
            <div><p className="text-slate-500">ОКВ / ОКВ с оборудованием</p><b>4 294 / 18 (0,419 %) <span className="text-blue-600">22</span></b></div>
            <div><p className="text-slate-500">АКВ / АКВ с оборудованием</p><b>{mode === "created" ? "2" : "1"} / 0 (0 %) <span className="text-blue-600">0</span></b></div>
          </div>
          <div className="space-y-3 border-r p-4">
            <div><p className="text-slate-500">Средний чек одного оборудования</p><b>0 SUM</b></div>
            <div><p className="text-slate-500">От 0 SUM до 1 500 000 SUM</p><b>18 шт. (100%) <span className="text-blue-600">22</span></b></div>
          </div>
          <div className="space-y-3 border-r p-4">
            <div><p className="flex items-center gap-3 text-slate-500">От 1 500 000 SUM до 3 000 000 SUM <Pencil className="h-5 w-5" /></p><b>0 шт. (0%) <span className="text-blue-600">0</span></b></div>
            <div><p className="text-slate-500">Больше 3 000 000 SUM</p><b>0 шт. (0%) <span className="text-blue-600">0</span></b></div>
          </div>
          <div className="space-y-3 p-4 text-right">
            <div><p className="text-slate-500">Фактическая продажа</p><b>{mode === "created" ? "806,35" : "17,6"} SUM</b></div>
            <div><p className="text-slate-500">С оборудованием</p><b>0 SUM (0 %)</b></div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <h2 className="text-lg font-semibold">Продажи</h2>
          <label className="flex w-64 items-center border-b pb-2 text-slate-400">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full outline-none" />
            <Search className="h-6 w-6" />
          </label>
          <div className="flex items-center gap-5 text-slate-600">
            <span>25</span><span>1 - {rows.length} из {rows.length}</span>
            <ChevronLeft className="h-6 w-6 text-slate-400" /><ChevronRight className="h-6 w-6 text-slate-400" />
            <List className="h-6 w-6" />
            <button onClick={() => setFullscreen((value) => !value)} aria-label="Полноэкранный режим"><Expand className="h-6 w-6" /></button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>{["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"].map((title) => <th key={title} className="border px-2 py-3 text-center text-base font-semibold">{title}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.client} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                  <td className="border px-2 py-3">{row.client}</td>
                  {Array.from({ length: 4 }).map((_, cell) => <td key={cell} className="border px-2 py-3">0 SUM</td>)}
                  <td className="border px-2 py-3">{row.equipment}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="p-12 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/35 p-4 md:p-8" role="dialog" aria-modal="true">
          <form onSubmit={applyFilters} className="mx-auto max-w-[1840px] bg-white p-8 shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-xl font-bold">ФИЛЬТР</h2>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label="Закрыть фильтр"><X className="h-7 w-7 text-slate-500" /></button>
            </div>
            <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
              <label className="block"><span className="mb-2 block text-xs">Период по дате создания</span><input type="text" readOnly value="01 июля 2026 - 31 июля 2026" className="h-11 w-full border-b border-slate-300 outline-none" /></label>
              <NumberField label="Фактическая продажа (от)" value={draft.saleFrom} onChange={(value) => updateFilter("saleFrom", value)} />
              <NumberField label="Фактическая продажа (до)" value={draft.saleTo} onChange={(value) => updateFilter("saleTo", value)} />
              <SelectField label="Клиенты агента" value={draft.agent} options={selectOptions.agent} onChange={(value) => updateFilter("agent", value)} />
              <SelectField label="Организация" value={draft.organization} options={selectOptions.organization} onChange={(value) => updateFilter("organization", value)} />
              <SelectField label="Зона" value={draft.zone} options={selectOptions.zone} onChange={(value) => updateFilter("zone", value)} />
              <NumberField label="Факт продаж оборудования (от)" value={draft.equipmentSaleFrom} onChange={(value) => updateFilter("equipmentSaleFrom", value)} />
              <NumberField label="Факт продаж оборудования (до)" value={draft.equipmentSaleTo} onChange={(value) => updateFilter("equipmentSaleTo", value)} />
              <SelectField label="Филиалы" value={draft.branch} options={selectOptions.branch} onChange={(value) => updateFilter("branch", value)} />
              <SelectField label="Инвентарь" value={draft.inventory} options={selectOptions.inventory} onChange={(value) => updateFilter("inventory", value)} />
              <SelectField label="Тип инвентаря" value={draft.inventoryType} options={selectOptions.inventoryType} onChange={(value) => updateFilter("inventoryType", value)} />
              <SelectField label="Тип клиента" value={draft.clientType} options={selectOptions.clientType} onChange={(value) => updateFilter("clientType", value)} />
              <SelectField label="Тип товара" value={draft.productType} options={selectOptions.productType} onChange={(value) => updateFilter("productType", value)} />
              <SelectField label="Товар" value={draft.product} options={selectOptions.product} onChange={(value) => updateFilter("product", value)} />
            </div>
            <button type="submit" className="mt-8 w-full rounded-md bg-emerald-400 py-3 text-lg font-semibold text-white">Применить</button>
          </form>
        </div>
      )}
    </main>
  )
}
