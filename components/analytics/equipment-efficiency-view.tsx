"use client"

import { useMemo, useState } from "react"
import { Pencil, Search } from "lucide-react"
import { RefHeader, RefNothingFound } from "@/components/ref/list-kit"
import { ReportDateField, ReportFilterPanel, ReportInputField, ReportPage, ReportPager, ReportRangeField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
import { TABLE_SETTINGS_ICON, TableColumnsDrawer } from "@/components/ref/table-columns-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"
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

// The list's columns (Linko's «Настройка таблицы» hides or shows each) and their widths.
type ColumnKey = "client" | "sales" | "gearSales" | "variety" | "products" | "equipment"
const COLUMNS: { key: ColumnKey; title: string; width?: number }[] = [
  { key: "client", title: "Клиент", width: 220 },
  { key: "sales", title: "Факт. продажи", width: 237 },
  { key: "gearSales", title: "Факт. продажи оборудования", width: 237 },
  { key: "variety", title: "Разновидности", width: 237 },
  { key: "products", title: "Кол-во продуктов", width: 237 },
  { key: "equipment", title: "Оборудование" },
]
const ALL_COLUMNS = Object.fromEntries(COLUMNS.map((column) => [column.key, true])) as Record<ColumnKey, boolean>
const FULLSCREEN = "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
const FULLSCREEN_EXIT = "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"

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

/** Blue-underlined group heading of the reference's filter ("Клиенты и инвентарь" / "Заказы"). */
function FilterSection({ title }: { title: string }) {
  const { t } = useLanguage()
  return <h3 className="col-span-full -mb-[5px] mt-[10px] border-b border-[#a7b3e6] pb-[3px] text-[12px] font-semibold text-[#5d6ba3]">{t(title)}</h3>
}

/** «От / До» pair of numeric fields under a plain caption (fact sales of the filter). */
function FilterPair({ caption, from, to, onFrom, onTo }: { caption: string; from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <div>
      <p className="h-[18px] text-[13px] leading-[18px] text-[#555]">{t(caption)}</p>
      <div className="grid grid-cols-2 gap-x-[10.67px]">
        <ReportInputField label="От" value={from} onChange={onFrom} />
        <ReportInputField label="До" value={to} onChange={onTo} />
      </div>
    </div>
  )
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
  const [mode] = useState<"created" | "realized">("created")
  const [filterOpen, setFilterOpen] = useState(false)
  const [realizedDate, setRealizedDate] = useState("")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [fullscreen, setFullscreen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [visible, setVisible] = useState(ALL_COLUMNS)
  const [columnsOpen, setColumnsOpen] = useState(false)
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
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const shownColumns = COLUMNS.filter((column) => visible[column.key])
  const cell = (row: EquipmentRow, key: ColumnKey) => {
    if (key === "client") return <td key={key} className="truncate px-[6px]">{row.client}</td>
    if (key === "equipment") return <td key={key} className="border-l border-[#ececec] px-[6px] py-[5px] leading-[18px]"><span className="line-clamp-2">{row.equipment}</span></td>
    return <td key={key} className="border-l border-[#ececec] px-[6px] text-right">{fmt(row[key])}</td>
  }

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
          <ReportTopRow filterLabel="Фильтр" scope={filters.organization || t("Во всей организации")} onFilter={() => { setDraft(filters); setFilterOpen(true) }} onDownload={downloadExcel} />

          <div className="mt-[15px] grid border border-[#e8e8e8] md:grid-cols-4">
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">ОКВ / ОКВ с оборудованием</p><b className="text-[13px]">{fmt(total?.okb ?? 0)} / {fmt(total?.okb_gear ?? 0)} ({percent(total?.okb_gear ?? 0, total?.okb ?? 0)} %) <span className="text-[#1E4A9A]">{total?.okb_gear_count ?? 0}</span></b></div>
              <div><p className="text-[13px] text-[#555]">АКВ / АКВ с оборудованием</p><b className="text-[13px]">{fmt(total?.akb ?? 0)} / {fmt(total?.akb_gear ?? 0)} ({percent(total?.akb_gear ?? 0, total?.akb ?? 0)} %) <span className="text-[#1E4A9A]">{total?.akb_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="text-[13px] text-[#555]">Средний чек одного оборудования</p><b className="text-[13px]">{fmt(total?.avg_check ?? 0)} {total?.currency ?? "SUM"}</b></div>
              <div><p className="text-[13px] text-[#555]">От 0 SUM до 1 500 000 SUM</p><b className="text-[13px]">{total?.first_amount ?? 0} <span data-no-translate>шт.</span> ({percent(total?.first_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#1E4A9A]">{total?.first_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] border-r border-[#e8e8e8] px-[15px] py-[11px]">
              <div><p className="flex items-center gap-3 text-[13px] text-[#555]">От 1 500 000 SUM до 3 000 000 SUM <Pencil className="h-4 w-4 text-[#555]" /></p><b className="text-[13px]">{total?.second_amount ?? 0} <span data-no-translate>шт.</span> ({percent(total?.second_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#1E4A9A]">{total?.second_gear_count ?? 0}</span></b></div>
              <div><p className="text-[13px] text-[#555]">Больше 3 000 000 SUM</p><b className="text-[13px]">{total?.third_amount ?? 0} <span data-no-translate>шт.</span> ({percent(total?.third_amount ?? 0, total?.okb_gear ?? 0)}%) <span className="text-[#1E4A9A]">{total?.third_gear_count ?? 0}</span></b></div>
            </div>
            <div className="space-y-[10px] px-[15px] py-[11px] text-right">
              <div><p className="text-[13px] text-[#555]">Фактическая продажа</p><b className="text-[13px]">{fmt(total?.total_fact ?? 0)} {total?.currency ?? "SUM"}</b></div>
              <div><p className="text-[13px] text-[#555]">С оборудованием</p><b className="text-[13px]">{fmt(total?.total_fact_gear ?? 0)} {total?.currency ?? "SUM"} ({percent(total?.total_fact_gear ?? 0, total?.total_fact ?? 0)} %)</b></div>
            </div>
          </div>

          <div className="mt-[15px] flex h-[52px] items-center justify-between border-t border-[#e8e8e8] pt-[8px]">
            <h2 className="text-[13px] font-semibold">{t("Продажи")}</h2>
            <label className="relative ml-[110px] block h-[28px] w-[182px] border-b border-[#e0e0e0]">
              {!query && <span className="pointer-events-none absolute left-0 top-[5px] text-[13px] text-[#999]">{t("Поиск")}</span>}
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label={t("Поиск")} />
              <Search className="pointer-events-none absolute right-[2px] top-[2px] h-6 w-6 text-[#999]" />
            </label>
            <div className="flex items-center">
              {/* Linko: page size, «1 - 18 из 18», the round arrows, «Настройка таблицы» and full screen. */}
              <ReportPager
                pageSize={pageSize}
                onPageSize={(size) => { setPageSize(size); setPage(1) }}
                rangeLabel={`${(currentPage - 1) * pageSize + 1} - ${(currentPage - 1) * pageSize + pageRows.length} ${t("из")} ${rows.length}`}
                canPrev={currentPage > 1}
                canNext={currentPage < pageCount}
                onPrev={() => setPage(currentPage - 1)}
                onNext={() => setPage(currentPage + 1)}
              />
              <button type="button" onClick={() => setColumnsOpen(true)} aria-label={t("Настройка таблицы")} className="ml-[10px] flex h-10 w-10 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d={TABLE_SETTINGS_ICON} /></svg>
              </button>
              <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={t("Полноэкранный режим")} className="ml-[10px] flex h-10 w-10 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d={fullscreen ? FULLSCREEN_EXIT : FULLSCREEN} /></svg>
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-[13px]">
            <colgroup>{shownColumns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
            <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
              <tr className="h-[33px] bg-white">{shownColumns.map((column) => <th key={column.key} className="border-r border-[#e1e5eb] px-2 text-center font-semibold leading-4 last:border-r-0">{t(column.title)}</th>)}</tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr key={row.id} className={`min-h-[31px] h-[31px] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                  {shownColumns.map((column) => cell(row, column.key))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <RefNothingFound />}
        </div>
      </section>
      </div>

      {columnsOpen && (
        <TableColumnsDrawer
          columns={COLUMNS}
          visible={visible}
          onSave={(next) => { setVisible(next); setColumnsOpen(false) }}
          onClose={() => setColumnsOpen(false)}
        />
      )}
      {filterOpen && (
        <ReportFilterPanel normalCase onClose={() => setFilterOpen(false)} onApply={() => { setFilters(draft); setPage(1); setFilterOpen(false) }} onReset={() => { setDraft(emptyFilters); setFilters(emptyFilters); setRealizedDate(""); setFilterOpen(false) }}>
          <FilterSection title="Клиенты и инвентарь" />
          <ReportSelectField label="Ответственный агент клиента" value={draft.agent} options={selectOptions.agent} onChange={(value) => updateFilter("agent", value)} clearable={false} />
          <ReportSelectField label="Организация инвентаря" value={draft.organization} options={selectOptions.organization} onChange={(value) => updateFilter("organization", value)} clearable={false} />
          <ReportSelectField label="Зона" value={draft.zone} options={selectOptions.zone} onChange={(value) => updateFilter("zone", value)} clearable={false} />
          <ReportSelectField label="Филиалы" value={draft.branch} options={selectOptions.branch} onChange={(value) => updateFilter("branch", value)} clearable={false} />
          <ReportSelectField label="Инвентарь" value={draft.inventory} options={selectOptions.inventory} onChange={(value) => updateFilter("inventory", value)} clearable={false} />
          <ReportSelectField label="Тип инвентаря (продукт)" value={draft.inventoryType} options={selectOptions.inventoryType} onChange={(value) => updateFilter("inventoryType", value)} clearable={false} />
          <ReportSelectField label="Тип клиента" value={draft.clientType} options={selectOptions.clientType} onChange={(value) => updateFilter("clientType", value)} clearable={false} />
          <div className="hidden lg:block" />
          <FilterSection title="Заказы" />
          <ReportRangeField label="Период по дате создания" from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
          <ReportDateField label="Период по дате реализации" placeholder="Укажите Дату" value={realizedDate} onChange={setRealizedDate} />
          <FilterPair caption="Фактическая продажа" from={draft.saleFrom} to={draft.saleTo} onFrom={(value) => updateFilter("saleFrom", value)} onTo={(value) => updateFilter("saleTo", value)} />
          <FilterPair caption="Факт продаж оборудования" from={draft.equipmentSaleFrom} to={draft.equipmentSaleTo} onFrom={(value) => updateFilter("equipmentSaleFrom", value)} onTo={(value) => updateFilter("equipmentSaleTo", value)} />
          <ReportSelectField label="Товар" value={draft.product} options={selectOptions.product} onChange={(value) => updateFilter("product", value)} clearable={false} />
          <ReportSelectField label="Тип товара заказа" value={draft.productType} options={selectOptions.productType} onChange={(value) => updateFilter("productType", value)} clearable={false} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
