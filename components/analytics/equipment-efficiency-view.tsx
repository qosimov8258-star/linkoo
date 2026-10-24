"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Expand, List, Pencil, Search } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportInputField, ReportPage, ReportRangeField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useRefRecords } from "@/lib/use-ref-records"

// Clients with equipment and the summary of the reference's "Эффективность оборудования" (kind "gear": one record per client,
// plus the record "total" with the summary figures).
type EquipmentRow = {
  id: number | string
  client: string
  equipment: string
  sales: number
  gearSales: number
  variety: number
  products: number
  branch?: string
  inventoryType?: string
  isTotal?: boolean
}

type GearTotal = {
  okb: number
  okb_gear: number
  akb: number
  akb_gear: number
  avg_check: number
  first_amount: number
  second_amount: number
  third_amount: number
  total_fact: number
  total_fact_gear: number
  okb_gear_count: number
  akb_gear_count: number
  first_gear_count: number
  second_gear_count: number
  third_gear_count: number
  currency: string
}

const fmt = (value: number) => {
  const [whole, fraction] = value.toFixed(3).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return fraction ? `${grouped},${fraction}` : grouped
}
const percent = (part: number, whole: number) => (whole ? fmt((part / whole) * 100) : "0")

const selectOptions = {
  organization: ["Linko", "Time3 Distribution"],
  zone: ["Arslan", "spark", "Andijon shaharchasi"],
  agent: ["Admin Ritm", "Samandar Abdurahmonov"],
  branch: ["777", "878", "agent", "Andijon", "AURUM samarqand"],
  inventory: ["Холодильник", "Muzlatkich 2", "Texnik apparat"],
  inventoryType: ["Холодильник", "Морозильник", "Техническое оборудование", "Другое"],
  clientType: ["horeca", "market", "market100"],
  productType: ["Напитки", "Снеки", "Бытовая химия"],
  product: ["coca-cola", "lipton", "sprayt"],
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
  organization: "",
  zone: "",
  agent: "",
  branch: "",
  inventory: "",
  inventoryType: "",
  clientType: "",
  productType: "",
  product: "",
  saleFrom: "",
  saleTo: "",
  equipmentSaleFrom: "",
  equipmentSaleTo: "",
}

export function EquipmentEfficiencyView() {
  const [mode] = useState<"created" | "realized">("created")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [fullscreen, setFullscreen] = useState(false)
  const [rangeFrom, setRangeFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` })
  const [rangeTo, setRangeTo] = useState(() => { const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}` })

  const { rows: records } = useRefRecords<EquipmentRow>("gear")
  const equipmentRows = useMemo(() => records.filter((record) => !record.isTotal), [records])
  const total = useMemo(() => (records.find((record) => record.isTotal) as unknown as GearTotal | undefined) ?? null, [records])

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    return equipmentRows.filter((row) => {
      if (normalized && !`${row.client} ${row.equipment}`.toLocaleLowerCase("ru").includes(normalized)) return false
      if (filters.branch !== "" && row.branch !== filters.branch) return false
      if (filters.inventoryType !== "" && row.inventoryType !== filters.inventoryType) return false
      if (filters.inventory !== "" && !row.equipment.includes(filters.inventory)) return false
      if (filters.product !== "" && !row.equipment.toLowerCase().includes(filters.product.toLowerCase())) return false
      return true
    })
  }, [query, filters, equipmentRows])

  function updateFilter<Key extends keyof Filters>(key: Key, value: Filters[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function downloadExcel() {
    const header = ["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"]
    const body = rows.map((row) => [row.client, `${fmt(row.sales)} ${total?.currency ?? "SUM"}`, `${fmt(row.gearSales)} ${total?.currency ?? "SUM"}`, fmt(row.variety), fmt(row.products), row.equipment])
    downloadExcelTable("equipment-efficiency", [header, ...body])
  }

  return (
    <ReportPage>
      <div className={fullscreen ? "fixed inset-0 z-50 overflow-auto bg-[#f2f5f8]" : ""}>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title="Эффективность оборудования" />
      </div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[20px]">
        <div className="px-[30px]">
          <ReportTopRow filterLabel="Фильтр" scope={filters.organization || "Во всей организации"} onFilter={() => { setDraft(filters); setFilterOpen(true) }} onDownload={downloadExcel} />

          <div className="mt-[15px] grid border border-[#e8e8e8] md:grid-cols-4">
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">ОКВ / ОКВ с оборудованием</p><b className="text-[13px]">{fmt(total?.okb ?? 0)} / {fmt(total?.okb_gear ?? 0)} ({percent(total?.okb_gear ?? 0, total?.okb ?? 0)} %) <span className="text-[#4f71dc]">{total?.okb_gear_count ?? 0}</span></b></div>
              <div><p className="text-[13px] text-[#555]">АКВ / АКВ с оборудованием</p><b className="text-[13px]">{fmt(total?.akb ?? 0)} / {fmt(total?.akb_gear ?? 0)} ({percent(total?.akb_gear ?? 0, total?.akb ?? 0)} %) <span className="text-[#4f71dc]">{total?.akb_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">Средний чек одного оборудования</p><b className="text-[13px]">{fmt(total?.avg_check ?? 0)} {total?.currency ?? "SUM"}</b></div>
              <div><p className="text-[13px] text-[#555]">От 0 SUM до 1 500 000 SUM</p><b className="text-[13px]">{total?.first_amount ?? 0} шт. ({percent(total?.first_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#4f71dc]">{total?.first_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="flex items-center gap-3 text-[13px] text-[#555]">От 1 500 000 SUM до 3 000 000 SUM <Pencil className="h-4 w-4 text-[#555]" /></p><b className="text-[13px]">{total?.second_amount ?? 0} шт. ({percent(total?.second_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#4f71dc]">{total?.second_gear_count ?? 0}</span></b></div>
              <div><p className="text-[13px] text-[#555]">Больше 3 000 000 SUM</p><b className="text-[13px]">{total?.third_amount ?? 0} шт. ({percent(total?.third_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#4f71dc]">{total?.third_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] px-[15px] py-[11px] text-right">
              <div><p className="text-[13px] text-[#555]">Фактическая продажа</p><b className="text-[13px]">{fmt(total?.total_fact ?? 0)} {total?.currency ?? "SUM"}</b></div>
              <div><p className="text-[13px] text-[#555]">С оборудованием</p><b className="text-[13px]">{fmt(total?.total_fact_gear ?? 0)} {total?.currency ?? "SUM"} ({percent(total?.total_fact_gear ?? 0, total?.total_fact ?? 0)} %)</b></div>
            </div>
          </div>

          <div className="mt-[15px] flex h-[52px] items-center justify-between border-t border-[#e8e8e8] pt-[8px]">
            <h2 className="text-[13px] font-semibold">Продажи</h2>
            <label className="relative ml-[110px] block h-[28px] w-[182px] border-b border-[#e0e0e0]">
              {!query && <span className="pointer-events-none absolute left-0 top-[5px] text-[13px] text-[#999]">Поиск</span>}
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label="Поиск" />
              <Search className="pointer-events-none absolute right-[2px] top-[2px] h-6 w-6 text-[#999]" />
            </label>
            <div className="flex items-center gap-[20px] text-[13px] text-black">
              <span className="flex items-center">25<svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]"><path d="M7 10l5 5 5-5z" /></svg></span>
              <span>1 - {rows.length} из {rows.length}</span>
              <ChevronLeft className="h-6 w-6 text-[#999]" /><ChevronRight className="h-6 w-6 text-[#999]" />
              <List className="h-6 w-6 text-[#444]" />
              <button onClick={() => setFullscreen((value) => !value)} aria-label="Полноэкранный режим"><Expand className="h-5 w-5 text-[#444]" /></button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-[13px]">
            <colgroup><col className="w-[220px]" /><col className="w-[237px]" /><col className="w-[237px]" /><col className="w-[237px]" /><col className="w-[237px]" /><col /></colgroup>
            <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
              <tr className="h-[33px] bg-white">{["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"].map((title) => <th key={title} className="border-r border-[#e1e5eb] px-2 text-center font-semibold leading-4 last:border-r-0">{title}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className={`min-h-[31px] h-[31px] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                  <td className="truncate px-[6px]">{row.client}</td>
                  {[row.sales, row.gearSales, row.variety, row.products].map((value, cell) => <td key={cell} className="border-l border-[#ececec] px-[6px] text-right">{fmt(value)}</td>)}
                  <td className="border-l border-[#ececec] px-[6px] py-[5px] leading-[18px]"><span className="line-clamp-2">{row.equipment}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-12 text-center text-[13px] text-[#8c8c8c]">По вашему запросу ничего не найдено</p>}
        </div>
      </section>
      </div>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={() => { setFilters(draft); setFilterOpen(false) }}>
          <ReportRangeField label="Период по дате создания" from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
          <ReportInputField label="Фактическая продажа (от)" value={draft.saleFrom} onChange={(value) => updateFilter("saleFrom", value)} />
          <ReportInputField label="Фактическая продажа (до)" value={draft.saleTo} onChange={(value) => updateFilter("saleTo", value)} />
          <ReportSelectField label="Клиенты агента" value={draft.agent} options={selectOptions.agent} onChange={(value) => updateFilter("agent", value)} clearable={false} />
          <ReportSelectField label="Организация" value={draft.organization} options={selectOptions.organization} onChange={(value) => updateFilter("organization", value)} clearable={false} />
          <ReportSelectField label="Зона" value={draft.zone} options={selectOptions.zone} onChange={(value) => updateFilter("zone", value)} clearable={false} />
          <ReportInputField label="Факт продаж оборудования (от)" value={draft.equipmentSaleFrom} onChange={(value) => updateFilter("equipmentSaleFrom", value)} />
          <ReportInputField label="Факт продаж оборудования (до)" value={draft.equipmentSaleTo} onChange={(value) => updateFilter("equipmentSaleTo", value)} />
          <ReportSelectField label="Филиалы" value={draft.branch} options={selectOptions.branch} onChange={(value) => updateFilter("branch", value)} clearable={false} />
          <ReportSelectField label="Инвентарь" value={draft.inventory} options={selectOptions.inventory} onChange={(value) => updateFilter("inventory", value)} clearable={false} />
          <ReportSelectField label="Тип инвентаря" value={draft.inventoryType} options={selectOptions.inventoryType} onChange={(value) => updateFilter("inventoryType", value)} clearable={false} />
          <ReportSelectField label="Тип клиента" value={draft.clientType} options={selectOptions.clientType} onChange={(value) => updateFilter("clientType", value)} clearable={false} />
          <ReportSelectField label="Тип товара" value={draft.productType} options={selectOptions.productType} onChange={(value) => updateFilter("productType", value)} clearable={false} />
          <ReportSelectField label="Товар" value={draft.product} options={selectOptions.product} onChange={(value) => updateFilter("product", value)} clearable={false} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
