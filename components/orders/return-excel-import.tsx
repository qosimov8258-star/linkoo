"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

// «Импортировать c Excel» of «Возврат по старой базе» (Linko's ReturnCreateForm, old base only): a bordered row with
// «1. Загрузить шаблон» (Order_Return_Import_Example.xlsx: every catalog product with its price in the chosen price
// list and currency, Linko's sales/order_return/products_for_import/) and «2. Заполните excel и загрузите», which opens
// «Импорт с Excel». Its «Сохранить» reads the filled rows (an «Количество» above 0) and they REPLACE the return's
// list (Linko's import_excel answer), then «Продукты успешно добавлены».

export type ExcelProduct = { id: number; name: string; unit?: string; barcode?: string; article?: string }
export type ImportedReturnLine = { product: ExcelProduct; quantity: number; price?: number }

const FILE_NAME = "Order_Return_Import_Example.xlsx"
const ACCEPTED = /\.(xlsx|xls|csv)$/i
const MAX_BYTES = 10 * 1024 * 1024
const FILE_ICON = "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"
/** Linko rounds the imported amount and price to 3 decimals. */
const round3 = (value: number) => Math.round(value * 1000) / 1000
const cellText = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const cellNumber = (value: unknown) => {
  const text = cellText(value).replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")
  return text === "" ? Number.NaN : Number(text)
}

/** The rows of a filled template: by column (ID, name, barcode, article, quantity, price), header rows skipped. */
/** `error` is an i18n key; `names`: the products it is about. */
async function readRows(file: File, products: ExcelProduct[]): Promise<{ lines?: ImportedReturnLine[]; error?: string; names?: string }> {
  if (!ACCEPTED.test(file.name)) return { error: "Поддерживаются только файлы .xlsx, .xls и .csv" }
  if (file.size > MAX_BYTES) return { error: "Файл слишком большой (максимум 10 МБ)" }
  let rows: unknown[][]
  try {
    const XLSX = await import("xlsx")
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" })
    const sheet = book.Sheets[book.SheetNames[0]]
    rows = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][]) : []
  } catch {
    return { error: "Не удалось прочитать файл" }
  }
  const byId = new Map(products.map((product) => [product.id, product]))
  const byCode = (value: string, pick: (product: ExcelProduct) => string | undefined) => (value ? products.find((product) => cellText(pick(product)) === value) : undefined)
  const lines: ImportedReturnLine[] = []
  const missing: string[] = []
  for (const row of rows) {
    const quantity = cellNumber(row[4])
    if (!(quantity > 0)) continue
    const id = cellNumber(row[0])
    const name = cellText(row[1])
    const product =
      (Number.isInteger(id) ? byId.get(id) : undefined) ??
      byCode(cellText(row[2]), (entry) => entry.barcode) ??
      byCode(cellText(row[3]), (entry) => entry.article) ??
      (name ? products.find((entry) => entry.name.trim().toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru")) : undefined)
    if (!product) {
      missing.push(name || cellText(row[0]))
      continue
    }
    const price = cellNumber(row[5])
    lines.push({ product, quantity: round3(quantity), price: Number.isFinite(price) && price >= 0 ? round3(price) : undefined })
  }
  if (missing.length) return { error: "Товар не найден в каталоге", names: `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}` }
  return { lines }
}

/** The row under «Список товаров» (shown while «Импортировать c Excel» is on). */
export function ReturnExcelImport({
  products,
  priceOf,
  onImported,
}: {
  products: ExcelProduct[]
  /** A product's price in the return's price list and currency (the template's «Цена»). */
  priceOf: (product: ExcelProduct) => number
  onImported: (lines: ImportedReturnLine[]) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => setDone(false), 4000)
    return () => window.clearTimeout(timer)
  }, [done])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, busy])

  function downloadTemplate() {
    const rows = [...products].sort((a, b) => b.id - a.id).map((product) => [product.id, product.name, product.barcode && product.barcode !== "не установлен" ? product.barcode : null, product.article || null, null, priceOf(product)])
    downloadExcelTable(FILE_NAME, [["ID", t("Наименование товара"), t("Штрих код"), t("Артикуль"), t("Количество"), t("Цена")], ...rows])
  }

  async function save() {
    if (!file || busy) return
    setBusy(true)
    setError("")
    const result = await readRows(file, products)
    setBusy(false)
    if (!result.lines) {
      setError(`${t(result.error ?? "Не удалось прочитать файл")}${result.names ? `: ${result.names}` : ""}`)
      return
    }
    onImported(result.lines)
    setOpen(false)
    setFile(null)
    setDone(true)
  }

  return (
    <>
      <div className="mt-[10px] flex flex-wrap items-center justify-between border border-[#efefef] py-[5px]">
        <button type="button" onClick={downloadTemplate} className="h-9 px-[16px] text-[13px] uppercase text-black hover:bg-black/[0.04]">
          {t("1. Загрузить шаблон")}
        </button>
        <div className="mr-[16px] flex items-center">
          <button type="button" onClick={() => (setError(""), setOpen(true))} className="h-9 px-[16px] text-[13px] uppercase text-black hover:bg-black/[0.04]">
            {file ? t("2. Сменить файл") : t("2. Заполните excel и загрузите")}
          </button>
        </div>
      </div>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[1501] flex items-center justify-center bg-black/[0.54] p-4 font-sans" onMouseDown={(event) => event.target === event.currentTarget && !busy && setOpen(false)}>
            <div role="dialog" aria-modal="true" aria-label={t("Импорт с Excel")} className="w-[400px] max-w-full bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
              <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[27px]">
                <b className="text-[13px] font-bold uppercase text-[#333]">{t("Импорт с Excel")}</b>
                <button type="button" onClick={() => !busy && setOpen(false)} aria-label={t("Закрыть")} className="text-[#333]">
                  <X className="h-6 w-6" />
                </button>
              </header>
              <div className="px-[30px] pb-[20px] pt-[30px]">
                <div className="h-[237px] border border-[#efefef] pt-[10px]">
                  <label className="mx-auto flex h-[200px] w-[302px] cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-[#efefef] text-center text-[13px] text-[#333]">
                    <input
                      type="file"
                      accept=".csv,.xls,.xlsx"
                      className="hidden"
                      onChange={(event) => {
                        const picked = event.target.files?.[0] ?? null
                        // Cleared at once, so the same (corrected) file can be picked again.
                        event.target.value = ""
                        if (!picked) return
                        setFile(picked)
                        setError("")
                      }}
                    />
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
                      <path d={FILE_ICON} />
                    </svg>
                    <span>{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
                  </label>
                </div>
                {error && <div className="mt-3 text-[13px] text-[#e57373]">{error}</div>}
              </div>
              <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
                <button type="button" aria-disabled={!file || busy} onClick={() => void save()} className="h-9 bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95">
                  {t("Сохранить")}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
      {done && createPortal(<div className="fixed bottom-6 left-1/2 z-[1500] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-3 text-[14px] text-white shadow-lg">{t("Продукты успешно добавлены")}</div>, document.body)}
    </>
  )
}
