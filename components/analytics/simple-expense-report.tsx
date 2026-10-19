"use client"

import { useMemo, useState } from "react"

import { RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportFilterPanel, ReportPage, ReportPager, ReportRangeField, ReportSearchField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

export type ExpenseLine = { id: number; label: string; sum: number }

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toInputDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** «Расходы по категориям» / «Расходы на персонал»: same chrome, different first column. */
export function SimpleExpenseReport({
  title,
  labelHeader,
  rows,
  fileName,
}: {
  title: string
  labelHeader: string
  rows: ExpenseLine[]
  fileName: string
}) {
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)

  const today = useMemo(() => new Date(), [])
  const [rangeFrom, setRangeFrom] = useState(() => toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [rangeTo, setRangeTo] = useState(() => toInputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
  const [branch, setBranch] = useState("")
  const [organization, setOrganization] = useState("")

  const filtered = useMemo(() => rows.filter((row) => row.label.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))), [rows, search])
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const downloadAll = () => {
    downloadExcelTable(fileName, [[labelHeader, "Сумма (SUM)"], ...filtered.map((row) => [row.label, number(row.sum)])])
  }

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={title} /></div>

      <section className="min-h-[calc(100vh-110px)] bg-white pb-[30px]">
        <div className="h-[36px] border-b border-[#e0e0e0]" />
        <div className="px-[30px] pt-[20px]">
          <ReportTopRow filterLabel="Фильтр" scope="Во всей организации" onFilter={() => setFilterOpen(true)} onDownload={downloadAll} />
          <div className="mt-[10px] flex h-[53px] items-center border-t border-[#e8e8e8] border-b">
            <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={320} />
            <div className="ml-auto">
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 1} - ${Math.min(safePage * pageSize, filtered.length)} из ${filtered.length}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
            </div>
          </div>

          {visible.length > 0 ? (
            <table className="w-full border-collapse text-[13px]">
              <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
                <tr className="h-[40px]"><th className="px-2 text-left font-semibold">{labelHeader}</th><th className="px-2 text-left font-semibold">Сумма (SUM)</th></tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={row.id} className={`h-[31px] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                    <td className="px-2">{row.label}</td>
                    <td className="px-2">{number(row.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ReportEmpty className="pb-[20px] pt-[55px]" text="По вашему запросу ничего не найдено" />
          )}
        </div>
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
          <ReportRangeField label="Диапазон дат" from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={["Самарканд", "Ташкент", "Наманган"]} />
          <ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={["Linko"]} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
