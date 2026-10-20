"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Expand, List, Pencil, Search } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportInputField, ReportPage, ReportRangeField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"

type EquipmentRow = {
  client: string
  equipment: string
  branch: string
  inventoryType: string
}

const equipmentRows: EquipmentRow[] = []

// Generic equipment kinds; every other list comes from the factory's own directories.
const INVENTORY_TYPES = ["Холодильник", "Морозильник", "Техническое оборудование", "Другое"]

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
  const { t } = useLanguage()
  const selectOptions = {
    organization: useDirectoryNames("organizations"),
    zone: useDirectoryNames("zones"),
    agent: useDirectoryNames("employees"),
    branch: useDirectoryNames("branches"),
    inventory: INVENTORY_TYPES,
    inventoryType: INVENTORY_TYPES,
    clientType: useDirectoryNames("clientTypes"),
    productType: useDirectoryNames("productTypes"),
    product: [] as string[],
  }
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [fullscreen, setFullscreen] = useState(false)
  const [rangeFrom, setRangeFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` })
  const [rangeTo, setRangeTo] = useState(() => { const d = new Date(); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}` })

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
  }, [query, filters])

  function updateFilter<Key extends keyof Filters>(key: Key, value: Filters[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function downloadExcel() {
    const header = ["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"]
    const body = rows.map((row) => [row.client, "0 SUM", "0 SUM", "0 SUM", "0 SUM", row.equipment])
    downloadExcelTable("equipment-efficiency", [header, ...body])
  }

  return (
    <ReportPage>
      <div className={fullscreen ? "fixed inset-0 z-50 overflow-auto bg-[#f2f5f8]" : ""}>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Эффективность оборудования")}>
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <button type="button" onClick={() => setMode("created")} className={`h-[30px] px-4 text-[13px] font-medium transition-colors ${mode === "created" ? "bg-[#71ce87] text-white" : "bg-white text-black"}`}>{t("ПО ДАТЕ СОЗДАНИЕ")}</button>
            <button type="button" onClick={() => setMode("realized")} className={`h-[30px] px-4 text-[13px] font-medium transition-colors ${mode === "realized" ? "bg-[#71ce87] text-white" : "bg-white text-black"}`}>{t("ПО ДАТЕ РЕАЛИЗАЦИИ")}</button>
          </div>
        </RefHeader>
      </div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[20px]">
        <div className="px-[30px]">
          <ReportTopRow filterLabel="Фильтр" scope={filters.organization || t("Во всей организации")} onFilter={() => { setDraft(filters); setFilterOpen(true) }} onDownload={downloadExcel} />

          <div className="mt-[15px] grid border border-[#e8e8e8] md:grid-cols-4">
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">{t("ОКВ / ОКВ с оборудованием")}</p><b className="text-[13px]">0 / 0 (0 %) <span className="text-[#4f71dc]">0</span></b></div>
              <div><p className="text-[13px] text-[#555]">{t("АКВ / АКВ с оборудованием")}</p><b className="text-[13px]">0 / 0 (0 %) <span className="text-[#4f71dc]">0</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">{t("Средний чек одного оборудования")}</p><b className="text-[13px]">0 SUM</b></div>
              <div><p className="text-[13px] text-[#555]">{t("От 0 SUM до 1 500 000 SUM")}</p><b className="text-[13px]">0 {t("шт.")} (0%) <span className="text-[#4f71dc]">0</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="flex items-center gap-3 text-[13px] text-[#555]">{t("От 1 500 000 SUM до 3 000 000 SUM")} <Pencil className="h-4 w-4 text-[#555]" /></p><b className="text-[13px]">0 {t("шт.")} (0%) <span className="text-[#4f71dc]">0</span></b></div>
              <div><p className="text-[13px] text-[#555]">{t("Больше 3 000 000 SUM")}</p><b className="text-[13px]">0 {t("шт.")} (0%) <span className="text-[#4f71dc]">0</span></b></div>
            </div>
            <div className="space-y-[10px] px-[15px] py-[11px] text-right">
              <div><p className="text-[13px] text-[#555]">{t("Фактическая продажа")}</p><b className="text-[13px]">0 SUM</b></div>
              <div><p className="text-[13px] text-[#555]">{t("С оборудованием")}</p><b className="text-[13px]">0 SUM (0 %)</b></div>
            </div>
          </div>

          <div className="mt-[15px] flex h-[52px] items-center justify-between border-t border-[#e8e8e8] pt-[8px]">
            <h2 className="text-[13px] font-semibold">{t("Продажи")}</h2>
            <label className="relative ml-[110px] block h-[28px] w-[182px] border-b border-[#e0e0e0]">
              {!query && <span className="pointer-events-none absolute left-0 top-[5px] text-[13px] text-[#999]">{t("Поиск")}</span>}
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label={t("Поиск")} />
              <Search className="pointer-events-none absolute right-[2px] top-[2px] h-6 w-6 text-[#999]" />
            </label>
            <div className="flex items-center gap-[20px] text-[13px] text-black">
              <span className="flex items-center">25<svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]"><path d="M7 10l5 5 5-5z" /></svg></span>
              <span>1 - {rows.length} {t("из")} {rows.length}</span>
              <ChevronLeft className="h-6 w-6 text-[#999]" /><ChevronRight className="h-6 w-6 text-[#999]" />
              <List className="h-6 w-6 text-[#444]" />
              <button onClick={() => setFullscreen((value) => !value)} aria-label={t("Полноэкранный режим")}><Expand className="h-5 w-5 text-[#444]" /></button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-[13px]">
            <colgroup><col className="w-[220px]" /><col className="w-[200px]" /><col className="w-[200px]" /><col className="w-[200px]" /><col className="w-[200px]" /><col /></colgroup>
            <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
              <tr className="h-[48px] bg-[#f2f5f8]">{["Клиент", "Факт. продажи", "Факт. продажи оборудования", "Разновидности", "Кол-во продуктов", "Оборудование"].map((title) => <th key={title} className="border-r border-[#e1e5eb] px-2 text-center font-semibold leading-4 last:border-r-0">{t(title)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.client} className={`h-[31px] ${index % 2 ? "bg-white" : "bg-[#f2f5f8]"}`}>
                  <td className="truncate px-[6px]">{row.client}</td>
                  {Array.from({ length: 4 }).map((_, cell) => <td key={cell} className="border-l border-[#ececec] px-[6px]">0</td>)}
                  <td className="border-l border-[#ececec] px-[6px]">{row.equipment}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-12 text-center text-[13px] text-[#8c8c8c]">{t("По вашему запросу ничего не найдено")}</p>}
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
