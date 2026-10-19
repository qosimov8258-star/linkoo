"use client"

import { useRef, useState } from "react"
import { FileSpreadsheet } from "lucide-react"

import { CashModal, PrimaryButton, SecondaryButton } from "@/components/analytics/cash-management-shared"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockInventoryDetail, StockInventoryImportRow, StockInventoryType } from "@/lib/stock-inventories-types"

// Demo "Импорт с Excel" (module 4758 + INVENTORY_IMPORT_DIALOG_OPEN of c83):
// the filled template (Наименование | Артикул | Ед. изм. | Остаток | Факт. остаток)
// is read in the browser and POSTed to /api/stock/inventories/import, which
// creates a pending inventory ("Продукты успешно добавлены").

const HEADER_ALIASES: Record<string, string> = {
  "наименование": "name",
  "название": "name",
  "товар": "name",
  "продукт": "name",
  "name": "name",
  "product": "name",
  "nomi": "name",
  "mahsulot": "name",
  "ady": "name",
  "артикул": "article",
  "article": "article",
  "vendor code": "article",
  "artikul": "article",
  "maqola": "article",
  "real balance": "amount",
  "actual balance": "amount",
  "hakyky galyndy": "amount",
  "факт остаток": "amount",
  "фактический остаток": "amount",
  "факт": "amount",
  "количество": "amount",
  "кол во": "amount",
  "amount": "amount",
  "qty": "amount",
  "quantity": "amount",
  "haqiqiy qoldiq": "amount",
  "miqdor": "amount",
  "soni": "amount",
}

/** Sheet rows → import rows (header row optional; without one: name first, amount last).
 * `extraAliases` adds the template headers in the UI language. */
export function inventoryImportRows(sheet: string[][], extraAliases: Record<string, string> = {}): StockInventoryImportRow[] {
  if (!sheet.length) return []
  const columns = mapHeaderColumns(sheet[0], { ...HEADER_ALIASES, ...extraAliases })
  const fields = new Map([...columns].map(([index, field]) => [field, index]))
  const hasHeader = fields.has("name") && fields.has("amount")
  const body = hasHeader ? sheet.slice(1) : sheet
  const offset = hasHeader ? 2 : 1
  return body
    .map((row, index) => ({
      name: hasHeader ? row[fields.get("name")!] ?? "" : row[0] ?? "",
      article: hasHeader && fields.has("article") ? row[fields.get("article")!] ?? "" : "",
      amount: hasHeader ? row[fields.get("amount")!] ?? "" : row[row.length - 1] ?? "",
      line: index + offset,
    }))
    .filter((row) => row.name.trim() || row.article.trim() || String(row.amount).trim())
}

export function InventoryImportDialog({
  header,
  onClose,
  onDone,
}: {
  header: { type: StockInventoryType; warehouse: string; invDate?: string; forDayEnd: boolean; comment: string }
  onClose: () => void
  onDone: (detail: StockInventoryDetail) => void
}) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [details, setDetails] = useState<string[]>([])

  const submit = async () => {
    if (!file) return setError(t("Выберите файл"))
    setBusy(true)
    setError("")
    setDetails([])
    const aliases = { [normalizeHeader(t("Наименование"))]: "name", [normalizeHeader(t("Артикул"))]: "article", [normalizeHeader(t("Факт. остаток"))]: "amount" }
    const rows = inventoryImportRows(await readExcelRows(file), aliases)
    if (!rows.length) {
      setBusy(false)
      return setError(t("В файле нет заполненных строк"))
    }
    // Plain fetch: the 400 answer carries `missing` (unknown names) / `lines` (bad amounts) too.
    try {
      const response = await fetch("/api/stock/inventories/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...header, rows }) })
      const body = (await response.json().catch(() => null)) as (StockInventoryDetail & { error?: string; missing?: string[]; lines?: number[] }) | null
      setBusy(false)
      if (response.ok && body) return onDone(body)
      setError(response.status === 403 ? t("Недостаточно прав") : t(body?.error || `HTTP ${response.status}`))
      if (body?.missing?.length) setDetails(body.missing)
      else if (body?.lines?.length) setDetails(body.lines.map((line) => `${t("Строка")} ${line}`))
    } catch {
      setBusy(false)
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  return (
    <CashModal
      title={t("Импорт с Excel")}
      onClose={onClose}
      size="sm"
      zIndex={150}
      footer={
        <>
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!file} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[14px]">
        <p className="text-[#586174]">
          {t("Склад")}: <b className="text-[#17233b]">{header.warehouse}</b>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError("")
            setDetails([])
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[#81c784] px-4 py-6 font-medium text-[rgb(129,199,132)] hover:bg-[#f4fbf4]"
        >
          <FileSpreadsheet className="h-5 w-5" />
          {file ? `${t("2. Сменить файл")}: ${file.name}` : t("2. Заполните excel и загрузите")}
        </button>
        {error && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-[13px] text-[#d64545]">{error}</p>}
        {details.length > 0 && (
          <ul className="max-h-40 list-disc overflow-auto pl-5 text-[13px] text-[#d64545]">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </CashModal>
  )
}
