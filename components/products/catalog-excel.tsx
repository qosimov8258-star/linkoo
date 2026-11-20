"use client"

import { useRef, useState } from "react"

import { CashModal, PrimaryButton } from "@/components/analytics/cash-management-shared"
import { KIND_TEXT, catalogMutate, errorText, formatNumber } from "@/components/products/catalog-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, type CatalogImportMode, type CatalogImportResult, type CatalogItem, type CatalogKind, type CatalogOptions } from "@/lib/products-types"

// Excel of the catalog pages: the list export (demo columns: Наименование | Штрих - код
// товара | Артикул | Тип товара | Организация | Мера | В кейсе | Дата создания | Порядковый
// номер), the import template, the "Обновить с excel" sheet (current values with ID) and
// the "Импорт с Excel" dialog (module 1617) posting the rows to {api}/import.

type Translate = (text: string) => string
type Cell = string | number

export function catalogListSheet(items: CatalogItem[], t: Translate): Cell[][] {
  // Linko's sheet: an empty cell reads «Не указано», «Мера» is the base unit and «В кейсе» the bare group size.
  const none = t("Не указано")
  return [
    [t("Наименование"), t("Штрих - код товара"), t("Артикул"), t("Тип товара"), t("Организация"), t("Мера"), t("В кейсе"), t("Дата создания"), t("Порядковый номер")],
    ...items.map((item) => [
      item.name,
      item.barcodes.join(", ") || none,
      item.article || "-",
      item.subcategory || item.type || none,
      item.organization || none,
      item.unit || none,
      item.boxAmount > 0 ? formatNumber(item.boxAmount) : "-",
      item.createdDate || none,
      item.orderNumber || none,
    ]),
  ]
}

/** Columns of the import / update sheets (header texts are recognised by the server). */
const COLUMNS: Array<{ title: string; value: (item: CatalogItem) => Cell }> = [
  { title: "Наименование", value: (item) => item.name },
  { title: "Мера", value: (item) => item.unit },
  { title: "Полное наименование", value: (item) => item.fullName },
  { title: "Штрих-код", value: (item) => item.barcodes.join(", ") },
  { title: "Артикул", value: (item) => item.article },
  { title: "Код для интеграции", value: (item) => item.code },
  { title: "Тип продукта", value: (item) => item.type },
  { title: "Подкатегория", value: (item) => item.subcategory },
  { title: "Группа", value: (item) => item.boxUnit },
  { title: "Кол-во в группе", value: (item) => item.boxAmount || "" },
  { title: "Организация", value: (item) => item.organization },
  { title: "Бренд", value: (item) => item.brand },
  { title: "Поставщик", value: (item) => item.supplier },
  { title: "Цвет", value: (item) => item.color },
  { title: "Порядковый номер", value: (item) => item.orderNumber },
  { title: "Минимальный остаток", value: (item) => item.minStock || "" },
  { title: "Описание", value: (item) => item.description },
  { title: "Икпу", value: (item) => item.ikpu },
  { title: "НДС", value: (item) => item.vat },
  { title: "Масса - кг", value: (item) => item.weight || "" },
  { title: "Вес нетто", value: (item) => item.netWeight || "" },
  { title: "Объем", value: (item) => item.volume || "" },
  { title: "Можно продавать", value: (item) => (item.canSell ? "Да" : "Нет") },
]

function priceColumns(options: CatalogOptions | null): string[] {
  return (options?.priceLists ?? []).flatMap((entry) => [`Нал: ${entry.name}`, `Безнал: ${entry.name}`])
}

export function downloadImportTemplate(kind: CatalogKind, options: CatalogOptions | null, t: Translate) {
  downloadExcelTable(`${t(KIND_TEXT[kind].excel)} - ${t("шаблон")}`, [[...COLUMNS.map((column) => column.title), ...priceColumns(options)]])
}

export function downloadUpdateSheet(kind: CatalogKind, items: CatalogItem[], options: CatalogOptions | null, t: Translate) {
  const prices = options?.priceLists ?? []
  downloadExcelTable(`${t(KIND_TEXT[kind].excel)} - ${t("обновление")}`, [
    ["ID", ...COLUMNS.map((column) => column.title), ...priceColumns(options)],
    ...items.map((item): Cell[] => [
      item.id,
      ...COLUMNS.map((column) => column.value(item)),
      ...prices.flatMap((list): Cell[] => {
        const entry = item.priceLists.find((price) => price.name.trim().toLowerCase() === list.name.trim().toLowerCase())
        return entry ? [entry.cash, entry.nonCash] : ["", ""]
      }),
    ]),
  ])
}

export function CatalogImportDialog({
  kind,
  mode,
  onTemplate,
  onClose,
  onDone,
}: {
  kind: CatalogKind
  mode: CatalogImportMode
  onTemplate: () => Promise<void> | void
  onClose: () => void
  onDone: (result: CatalogImportResult) => void
}) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; error: string }>>([])

  const submit = async () => {
    if (!file) return setError(t("Выберите файл"))
    setBusy(true)
    setError("")
    setRowErrors([])
    const rows = await readExcelRows(file)
    if (rows.length < 2) {
      setBusy(false)
      return setError(t("Не удалось найти товары для импорта в выбранном файле"))
    }
    const result = await catalogMutate<CatalogImportResult>("POST", `${CATALOG_API[kind]}/import`, { mode, rows })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result, t))
      setRowErrors(result.errors ?? [])
      return
    }
    onDone(result.data)
  }

  // Linko's dialog (both «Импортировать» and «Обновить с excel» open it as «Импорт с Excel»): 400px wide, a bordered
  // box with «1. СКАЧАТЬ ШАБЛОН» centred over a 200px dashed drop zone, a green «СОХРАНИТЬ» button.
  return (
    <CashModal
      title={t("Импорт с Excel")}
      onClose={onClose}
      size="sm"
      footerButtons="filled"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} tone="green" onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="mb-[11px] mt-[15px] border border-[#efefef] pb-[25px] pl-5 pr-[17px] pt-[17px] text-center">
      <button type="button" onClick={() => void onTemplate()} className="mb-[14px] text-[13px] uppercase leading-4 text-[#333] hover:underline">
        {t("1. Скачать шаблон")}
      </button>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") input.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDrag(false)
          const dropped = event.dataTransfer.files?.[0]
          if (dropped) setFile(dropped)
        }}
        className={`flex h-[200px] cursor-pointer flex-col items-center justify-center border-2 border-dashed text-center text-[13px] text-[#333] ${drag ? "border-[#1E4A9A] bg-[#eef2ff]" : "border-[#efefef]"}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
          <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" />
        </svg>
        {file ? <span className="mt-[5px] font-semibold">{file.name}</span> : <p className="mt-[5px] leading-4">{t("Добавьте файл Excel или нажмите для выбора")}</p>}
      </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) setFile(picked)
          event.target.value = ""
        }}
      />
      {rowErrors.length > 0 && (
        <ul className="mt-3 max-h-48 overflow-y-auto rounded-md bg-[#fdecea] px-3 py-2 text-[13px] text-[#b71c1c]">
          {rowErrors.map((entry) => (
            <li key={`${entry.row}-${entry.error}`}>
              {t("Строка")} {entry.row}: {t(entry.error)}
            </li>
          ))}
        </ul>
      )}
    </CashModal>
  )
}
