"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FileSpreadsheet, Search, Upload, X } from "lucide-react"

import { MiniPager, PrimaryButton, SearchSelect, inputClass, parseAmount } from "@/components/analytics/cash-management-shared"
import { formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickRow } from "@/lib/internal-transfers-types"

// Product pickers of "Передачи между складами" (demo "добавить из списка",
// module 622 with fromAllBalances: the source warehouse's balances, "Фильтр по
// типу", "Фильтр по бренду", "Поиск товаров", Кол-во + Цена per row) and
// "Списание товара" ("добавить товары": Себестоимость instead of the price),
// plus the Excel import block ("1. Загрузить шаблон" / "2. Заполните excel и
// загрузите"). Quantities above "Доступно" are flagged; the server refuses them.

export type PickMode = "transfer" | "writeoff"
export type PickEntry = { row: StockPickRow; quantity: string; price: string }

const PAGE_SIZE = 25

export const validQty = (value: string) => {
  const text = value.replace(/[\s ]/g, "").replace(",", ".")
  return text !== "" && Number.isFinite(Number(text)) && Number(text) > 0
}

export function StockProductPicker({
  rows,
  warehouse,
  mode,
  currency,
  initial,
  onClose,
  onSubmit,
}: {
  rows: StockPickRow[]
  warehouse: string
  mode: PickMode
  currency: string
  /** Quantities / prices already on the document, by key. */
  initial: Map<string, { quantity: string; price: string }>
  onClose: () => void
  onSubmit: (entries: PickEntry[]) => void
}) {
  const { t } = useLanguage()
  const [values, setValues] = useState<Record<string, { quantity: string; price: string }>>(() => Object.fromEntries(initial))
  const [search, setSearch] = useState("")
  const [type, setType] = useState("")
  const [brand, setBrand] = useState("")
  const [inStock, setInStock] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const distinct = (list: string[]) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")).map((value) => ({ value, label: value }))
  const types = useMemo(() => distinct(rows.map((row) => row.type)), [rows])
  const brands = useMemo(() => distinct(rows.map((row) => row.brand)), [rows])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter(
      (row) =>
        (!type || row.type === type) &&
        (!brand || row.brand === brand) &&
        (!inStock || row.available > 0 || validQty(values[row.key]?.quantity ?? "")) &&
        (!needle || `${row.name} ${row.article}`.toLowerCase().includes(needle)),
    )
  }, [rows, type, brand, inStock, search, values])
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const chosen = rows.filter((row) => validQty(values[row.key]?.quantity ?? ""))
  const total = chosen.reduce((sum, row) => {
    const value = values[row.key]
    return sum + parseAmount(value.quantity) * (mode === "transfer" ? parseAmount(value.price) : row.cost)
  }, 0)

  const setValue = (row: StockPickRow, patch: Partial<{ quantity: string; price: string }>) =>
    setValues((currentValues) => {
      const base = currentValues[row.key] ?? { quantity: "", price: String(row.price || "") }
      return { ...currentValues, [row.key]: { ...base, ...patch } }
    })

  const headCell = "py-3 pr-3"
  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-white text-[14px] text-[#333]" role="dialog" aria-modal="true">
      <div className="flex min-h-[60px] items-center justify-between border-b border-[#efefef] px-4 md:px-[30px]">
        <div className="min-w-0">
          <span className="font-bold uppercase">{t("Добавление продуктов")}</span>
          <span className="ml-3 text-[13px] text-[#586174]">{warehouse}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-[#17233b]">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-[#efefef] px-4 py-3 md:px-[30px]">
        <div className="w-[220px] max-w-full">
          <SearchSelect value={type} options={types} placeholder={t("Фильтр по типу")} onChange={(value) => { setType(value); setPage(1) }} />
        </div>
        <div className="w-[220px] max-w-full">
          <SearchSelect value={brand} options={brands} placeholder={t("Фильтр по бренду")} onChange={(value) => { setBrand(value); setPage(1) }} />
        </div>
        <label className="relative w-[280px] max-w-full">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder={`${t("Поиск товаров")}...`}
            aria-label={t("Поиск товаров")}
            className={`${inputClass} bg-[#f2f5f8] pr-9`}
          />
          <Search className="pointer-events-none absolute right-2.5 top-2.5 h-5 w-5 text-[#bac6ce]" />
        </label>
        <label className="flex h-10 items-center gap-2 text-[13px] text-[#586174]">
          <input type="checkbox" checked={inStock} onChange={(event) => { setInStock(event.target.checked); setPage(1) }} className="h-4 w-4 accent-[rgb(79,113,220)]" />
          {t("Только продукты в наличии")}
        </label>
        <div className="ml-auto">
          <MiniPager page={current} pageSize={PAGE_SIZE} count={filtered.length} onPage={setPage} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-[30px]">
        {visible.length ? (
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="sticky top-0 z-[1] bg-white">
              <tr className="border-b border-[#efefef] text-left font-semibold">
                <th className={`${headCell} w-[32%]`}>{t("Наименование")}</th>
                <th className={headCell}>{t("Код")}</th>
                <th className={`${headCell} text-right`}>{t("Доступно")}</th>
                {mode === "writeoff" && <th className={`${headCell} text-right`}>{t("Себестоимость")}</th>}
                <th className={headCell}>{t("Кол-во")}</th>
                {mode === "transfer" && <th className={headCell}>{t("Цена")}</th>}
                <th className="py-3 text-right">{t("Сумма")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const value = values[row.key] ?? { quantity: "", price: String(row.price || "") }
                const entered = validQty(value.quantity)
                const qty = parseAmount(value.quantity)
                const over = entered && qty > row.available + 1e-9
                const sum = qty * (mode === "transfer" ? parseAmount(value.price) : row.cost)
                return (
                  <tr key={row.key} className="h-[50px] border-b border-[#f2f5f8] hover:bg-[#f2f5f8]">
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-[#586174]">{row.article || "-"}</td>
                    <td className={`whitespace-nowrap py-2 pr-3 text-right ${row.available <= 0 ? "text-[#e57373]" : ""}`}>{formatQty(row.available, row.unit)}</td>
                    {mode === "writeoff" && <td className="whitespace-nowrap py-2 pr-3 text-right">{formatSum(row.cost)}</td>}
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <input
                          value={value.quantity}
                          inputMode="decimal"
                          aria-label={`${t("Кол-во")}: ${row.name}`}
                          title={over ? t("Больше доступного количества") : undefined}
                          onChange={(event) => setValue(row, { quantity: event.target.value })}
                          className={`h-9 w-[90px] border-b bg-transparent px-1 outline-none ${(value.quantity && !entered) || over ? "border-[#e57373] text-[#e57373]" : "border-[#5d6474]"}`}
                        />
                        <span className="text-[#586174]">{row.unit}</span>
                      </span>
                    </td>
                    {mode === "transfer" && (
                      <td className="py-2 pr-3">
                        <input
                          value={value.price}
                          inputMode="decimal"
                          aria-label={`${t("Цена")}: ${row.name}`}
                          onChange={(event) => setValue(row, { price: event.target.value })}
                          className="h-9 w-[110px] border-b border-[#5d6474] bg-transparent px-1 outline-none"
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap py-2 text-right">{entered ? formatSum(sum, currency) : "-"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="py-24 text-center text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}...</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-[#efefef] px-4 py-3 md:px-[30px]">
        <span className="mr-auto text-[13px] text-[#586174]">
          {t("Общее кол-во")}: {chosen.length} · {t("Общая сумма")}: {formatSum(total, currency)}
        </span>
        <PrimaryButton
          onClick={() =>
            onSubmit(chosen.map((row) => ({ row, quantity: values[row.key].quantity.trim(), price: (values[row.key].price ?? "").trim() })))
          }
        >
          {t("Сохранить")}
        </PrimaryButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Excel import ("Импортировать c Excel")
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  id: "key",
  ключ: "key",
  код: "code",
  артикул: "code",
  "код товара": "code",
  наименование: "name",
  товар: "name",
  название: "name",
  "кол во": "qty",
  количество: "qty",
  цена: "price",
}

/** Template of the source warehouse's items (key column first so the upload matches exactly). */
export function pickTemplateSheet(rows: StockPickRow[], mode: PickMode, t: (text: string) => string): Array<Array<string | number>> {
  const header = ["ID", t("Код"), t("Наименование"), t("Ед. изм."), t("Доступно"), t("Кол-во"), ...(mode === "transfer" ? [t("Цена")] : [])]
  return [header, ...rows.filter((row) => row.available > 0).map((row) => [row.key, row.article, row.name, row.unit, row.available, "", ...(mode === "transfer" ? [row.price] : [])])]
}

/** Uploaded rows → entries (matched by ID, then Код, then Наименование). */
export async function parsePickExcel(file: File, rows: StockPickRow[]): Promise<{ entries: PickEntry[]; unknown: string[] }> {
  const table = await readExcelRows(file)
  if (!table.length) return { entries: [], unknown: [] }
  const columns = mapHeaderColumns(table[0], ALIASES)
  const col = (field: string) => [...columns].find(([, name]) => name === field)?.[0] ?? -1
  const [keyCol, codeCol, nameCol, qtyCol, priceCol] = ["key", "code", "name", "qty", "price"].map(col)
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const byCode = new Map(rows.filter((row) => row.article).map((row) => [row.article.trim().toLowerCase(), row]))
  const byName = new Map(rows.map((row) => [row.name.trim().toLowerCase(), row]))
  const entries = new Map<string, PickEntry>()
  const unknown: string[] = []
  for (const cells of table.slice(1)) {
    const quantity = qtyCol >= 0 ? (cells[qtyCol] ?? "").trim() : ""
    if (!validQty(quantity)) continue
    const row =
      (keyCol >= 0 && byKey.get((cells[keyCol] ?? "").trim())) ||
      (codeCol >= 0 && byCode.get((cells[codeCol] ?? "").trim().toLowerCase())) ||
      (nameCol >= 0 && byName.get((cells[nameCol] ?? "").trim().toLowerCase())) ||
      null
    if (!row) {
      unknown.push((nameCol >= 0 && cells[nameCol]) || (codeCol >= 0 && cells[codeCol]) || cells.join(" "))
      continue
    }
    const price = priceCol >= 0 && (cells[priceCol] ?? "").trim() ? cells[priceCol].trim() : String(row.price || "")
    entries.set(row.key, { row, quantity, price })
  }
  return { entries: [...entries.values()], unknown }
}

/** The inline Excel block of the dialogs. */
export function ExcelImportPanel({
  rows,
  mode,
  fileName,
  onImported,
  onError,
}: {
  rows: StockPickRow[]
  mode: PickMode
  fileName: string
  onImported: (entries: PickEntry[]) => void
  onError: (text: string) => void
}) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState("")
  const upload = async (picked: File | undefined) => {
    if (!picked) return
    setFile(picked.name)
    const { entries, unknown } = await parsePickExcel(picked, rows)
    if (unknown.length) onError(`${t("Товары не найдены на складе")}: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}`)
    if (entries.length) onImported(entries)
    else if (!unknown.length) onError(t("В файле нет товаров с количеством"))
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border border-[#efefef] px-3 py-2">
      <button type="button" onClick={() => downloadExcelTable(fileName, pickTemplateSheet(rows, mode, t))} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[rgb(79,113,220)] hover:underline">
        <FileSpreadsheet className="h-4 w-4" /> {t("1. Загрузить шаблон")}
      </button>
      <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[rgb(79,113,220)] hover:underline">
        <Upload className="h-4 w-4" /> {file ? t("2. Сменить файл") : t("2. Заполните excel и загрузите")}
      </button>
      {file && <span className="truncate text-[12px] text-[#586174]">{file}</span>}
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ""
        }}
      />
    </div>
  )
}
