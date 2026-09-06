"use client"

import { useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Maximize,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

type Mode = "quantity" | "cost" | "price"

type MaterialRow = {
  name: string
  article?: string
  opening: number
  openingCost: number
  supplies: number
  suppliesCost: number
  supplierReturns: number
  supplierReturnsCost: number
  returns: number
  returnsCost: number
  issued: number
  issuedCost: number
  writtenOff: number
  writtenOffCost: number
  otherIncome: number
  otherIncomeCost: number
  otherExpense: number
  otherExpenseCost: number
  ending: number
  endingCost: number
}

const rows: MaterialRow[] = []

const groups = [
  ["opening", "openingCost", "Остаток на начало периода"],
  ["supplies", "suppliesCost", "Поставки за период"],
  ["supplierReturns", "supplierReturnsCost", "Возврат по поставкам за период"],
  ["returns", "returnsCost", "Возврат"],
  ["issued", "issuedCost", "Выдано по заказу"],
  ["writtenOff", "writtenOffCost", "Списано за период"],
  ["otherIncome", "otherIncomeCost", "Прочий приход"],
  ["otherExpense", "otherExpenseCost", "Прочий расход"],
  ["ending", "endingCost", "Остаток на конец"],
] as const

const formatNumber = (value: number, fraction = false) =>
  new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fraction && value % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: fraction ? 2 : 1,
  }).format(value)

function SelectLine({ label, options = ["Все"] }: { label: string; options?: string[] }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(options[0])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 w-full items-end justify-between border-b border-slate-300 pb-2 text-left text-[16px] font-medium"
      >
        <span>{label}{value !== options[0] ? `: ${value}` : ""}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 max-h-48 overflow-y-auto border border-slate-200 bg-white py-1 shadow-xl">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setValue(option)
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[15px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold text-slate-900">{value}</p>
    </div>
  )
}

export function MaterialReportViewV2() {
  const [mode, setMode] = useState<Mode>("quantity")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [page, setPage] = useState(1)

  const filteredRows = useMemo(
    () => rows.filter((row) => `${row.name} ${row.article}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  )

  const downloadExcel = () => {
    const header = ["Товар", "Артикул", ...groups.flatMap(([, , title]) => [`${title}: Кол-во`, `${title}: Стоимость`])]
    const body = filteredRows.map((row) => [
      row.name,
      row.article ?? "",
      ...groups.flatMap(([quantity, cost]) => [row[quantity], row[cost]]),
    ])
    downloadExcelTable("material-report", [header, ...body])
  }

  const selectedMode = mode === "quantity" ? "Количество" : mode === "cost" ? "Себестоимость" : "Прайс лист"

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#f1f4f8] text-[#12213b]">
      <section className="flex min-h-[76px] items-center border-b border-slate-300 bg-[#f3f6fa] px-9">
        <FavoritesButton className="flex items-center gap-2 text-[25px] font-semibold text-[#4d72e5]" />
        <span className="mx-3 text-3xl text-[#566173]">|</span>
        <h1 className="text-[25px] font-semibold text-[#566173]">Остаток на определенную дату</h1>
      </section>

      <main className="bg-white px-9 pb-8 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              className="flex h-11 items-center gap-2 rounded-md bg-[#4e70dd] px-4 font-semibold text-white shadow-sm"
            >
              <Filter className="h-5 w-5" /> Фильтр
            </button>
            <button type="button" onClick={() => setFilterOpen(true)} className="font-medium text-[#4e70dd]">Во всей организации</button>
          </div>
          <button
            type="button"
            onClick={downloadExcel}
            className="flex h-11 items-center gap-2 rounded-md bg-[#6ccb88] px-5 font-semibold text-white"
          >
            <Download className="h-5 w-5" /> Скачать Excel
          </button>
        </div>

        <div className="mt-7 grid grid-cols-5 gap-x-8 gap-y-3 border-b border-slate-200 pb-10">
          <Metric label="Остаток на начало периода" value="0 шт" />
          <Metric label="Поставки за период" value="0 шт" />
          <Metric label="Прочие приходы на склад" value="0 SUM (0 шт)" />
          <Metric label="Выдано по заказу" value="0 шт" />
          <Metric label="Списано за период" value="0 SUM (0 шт)" />
          <Metric label="Остаток на конец периода" value="0 шт" />
          <Metric label="Возврат по поставкам за период" value="0 SUM (0 шт)" />
          <Metric label="Прочие расходы на склад" value="0 SUM (0 шт)" />
          <Metric label="Возврат" value="0 SUM (0 шт)" />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div className="flex overflow-hidden rounded-md border border-slate-300 shadow-sm">
            {([
              ["quantity", "КОЛ-ВО"],
              ["cost", "СЕБЕСТОИМОСТЬ"],
              ["price", "ПРАЙС ЛИСТ"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`h-10 px-5 text-[16px] ${mode === value ? "bg-[#5070d9] text-white" : "bg-white text-slate-900"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="relative block w-[250px] border-b border-slate-300 pb-2">
            <span className="font-semibold">Поиск</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="absolute inset-0 w-full bg-transparent pr-8 text-transparent outline-none caret-slate-900 focus:text-slate-900"
              aria-label="Поиск"
            />
            <Search className="absolute bottom-2 right-0 h-5 w-5 text-slate-500" />
          </label>

          <div className="min-w-[250px] border-b border-slate-300 pb-2">
            <span className="block text-xs">Группировка</span>
            <span className="flex items-center justify-between font-medium">
              По продукту <span className="text-slate-400">× <ChevronDown className="inline h-4 w-4" /></span>
            </span>
          </div>
          <div className="min-w-[250px] border-b border-slate-300 pb-2">
            <span className="block text-xs">Показать</span>
            <span className="flex items-center justify-between font-medium">
              {selectedMode} <span className="text-slate-400">× <ChevronDown className="inline h-4 w-4" /></span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span>25 <ChevronDown className="inline h-4 w-4" /></span>
            <span>{filteredRows.length ? (page - 1) * 25 + 1 : 0} - {Math.min(page * 25, filteredRows.length)} из {filteredRows.length}</span>
            <button onClick={() => setPage(Math.max(1, page - 1))}><ChevronLeft /></button>
            <button onClick={() => setPage(page + 1)}><ChevronRight /></button>
            <Maximize className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-2 overflow-x-auto border border-slate-200">
          <table className="min-w-[2200px] w-full border-collapse text-[15px]">
            <thead className="sticky top-0 z-10 bg-[#edf2f8] text-[#203555] shadow-md">
              <tr>
                <th className="w-[320px] border-r border-slate-300 px-3 py-3" />
                {groups.map(([, , title]) => (
                  <th key={title} colSpan={mode === "quantity" ? 1 : 2} className="border-r border-slate-300 px-3 py-2 text-center font-medium">
                    {title}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="border-r border-slate-300 px-3 py-2 text-center">Товар</th>
                {groups.flatMap(([, , title]) =>
                  mode === "quantity"
                    ? [<th key={`${title}-q`} className="border-r border-slate-300 px-3 py-2">Кол-во</th>]
                    : [
                        <th key={`${title}-q`} className="border-r border-slate-300 px-3 py-2">Кол-во</th>,
                        <th key={`${title}-c`} className="border-r border-slate-300 px-3 py-2">Стоимость</th>,
                      ],
                )}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={`${row.name}-${index}`} className={index % 2 ? "bg-[#eef3f8]" : "bg-white"}>
                  <td className="border-r border-t border-slate-200 px-2 py-2.5">
                    <div>{row.name}</div>
                    {row.article && <div className="font-medium text-[#43c875]">{row.article}</div>}
                  </td>
                  {groups.flatMap(([quantity, cost, title]) => {
                    const quantityCell = (
                      <td key={`${title}-q`} className="border-r border-t border-slate-200 px-2 py-2.5">
                        <span className={row[quantity] === 0 ? "text-[#0799ea]" : ""}>{formatNumber(row[quantity], true)}</span>
                      </td>
                    )
                    if (mode === "quantity") return [quantityCell]
                    return [
                      quantityCell,
                      <td key={`${title}-c`} className="border-r border-t border-slate-200 px-2 py-2.5">
                        {formatNumber(row[cost], true)}
                      </td>,
                    ]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/25 px-8 pt-[90px]">
          <div className="w-full max-w-[1840px] rounded-sm bg-white p-8 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Фильтр</h2>
              <button onClick={() => setFilterOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </div>
            <div className="mt-8 grid grid-cols-4 gap-x-12 gap-y-6">
              <div className="border-b border-slate-300 pb-2">
                <span className="block text-xs font-medium">Диапазон дат</span>
                <span className="mt-2 block">01 июля 2026 - 31 июля 2026</span>
              </div>
              <SelectLine label="Филиалы" options={["Все филиалы", "777", "878", "Andijon", "AURUM samarqand"]} />
              <SelectLine label="Организация" options={["Все организации", "Linko", "Time3 Distribution"]} />
              <SelectLine label="Склад" options={["Все склады", "Andijon skladi", "05,08,2025(1)", "Chinobod sklad"]} />
              <SelectLine label="Тип продукта" options={["Все типы", "Напитки", "Снеки", "Бытовая химия"]} />
              <SelectLine label="Бренд" options={["Все бренды", "coca-cola", "lipton", "sprayt"]} />
              <SelectLine label="Движение за период" options={["Все", "Приход", "Расход"]} />
              <SelectLine label="Остаток за период" options={["Все", "Положительный", "Отрицательный", "Нулевой"]} />
            </div>
            <label className="mt-6 flex items-center gap-2 text-[16px] font-medium">
              <input type="checkbox" className="h-5 w-5" /> Показать прочие
            </label>
            <button
              onClick={() => setFilterOpen(false)}
              className="mt-5 h-12 w-full rounded-md bg-[#6dce8b] text-[16px] font-semibold text-white"
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const MaterialReportView = MaterialReportViewV2
export default MaterialReportViewV2
