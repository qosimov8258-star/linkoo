"use client"

import { useState } from "react"

import { CashModal, FormField, PrimaryButton, SearchSelect, SecondaryButton } from "@/components/analytics/cash-management-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { mutateJson, mutationMessage } from "./price-lists-data"
import { REPRICINGS_API, type RepricingCreateResult, type RepricingOptions, type RepricingPickRow } from "./repricing-data"

// Dialogs of "Переоценка": "Переоценку связанных" (demo RevaluationRecalcForm, c143 module 5210:
// one "Прайс лист" field → POST main/reprice/connected/) and the Excel import of the create dialog
// (demo ExcelImportCreateForm: template download + upload; lines are matched by name / article /
// barcode and take the "Новая цена" column).

export function RepricingLinkedDialog({ options, onClose, onSaved }: { options: RepricingOptions | null; onClose: () => void; onSaved: (message: string, firstId: number | null) => void }) {
  const { t } = useLanguage()
  const [priceListId, setPriceListId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const lists = (options?.priceLists ?? []).filter((list) => list.dependents > 0 || list.linked)

  async function submit() {
    if (!priceListId) return setError(t("Это поле обязательно к заполнению"))
    setBusy(true)
    setError("")
    const result = await mutateJson<RepricingCreateResult>("POST", `${REPRICINGS_API}/connected`, { priceListId: Number(priceListId) })
    setBusy(false)
    if (!result.ok) return setError(t(mutationMessage(result)))
    const { linked, skipped } = result.data
    const created = linked.length ? `${t("Создано переоценок")}: ${linked.map((doc) => `№ ${doc.id} (${doc.priceList})`).join(", ")}` : t("Цены не изменились")
    const notes = skipped.length ? `. ${skipped.map((item) => `${item.priceList}: ${t(item.reason)}`).join("; ")}` : ""
    onSaved(`${created}${notes}`, linked[0]?.id ?? null)
  }

  // Reference ("openCreateRecalcDialog"): "ДОБАВИТЬ ПРАЙС-ЛИСТ", one edge-to-edge "Прайс лист" select and a green "СОХРАНИТЬ".
  return (
    <CashModal
      title={<span className="text-[16px]">{t("Добавить прайс-лист")}</span>}
      onClose={onClose}
      size="md"
      footerButtons="filled"
      footer={
        <>
          <button type="button" disabled={busy} onClick={() => void submit()} className="ml-[10px] mr-auto !h-9 rounded-[3px] !bg-[#71ce87] !px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {t("Сохранить")}
          </button>
          {error && <span className="text-[13px] text-[#e57373]">{error}</span>}
        </>
      }
    >
      <div className="-mx-[30px] min-h-[220px] pt-[10px]">
        <FormField label={t("Прайс лист")} semibold>
          <SearchSelect value={priceListId} options={lists.map((list) => ({ value: String(list.id), label: list.name, hint: list.dependents ? `${t("Связанных")}: ${list.dependents}` : undefined }))} onChange={setPriceListId} />
        </FormField>
        {!lists.length && <p className="mx-[30px] mt-3 text-[13px] text-[#e57373]">{t("Нет связанных прайс-листов")}</p>}
      </div>
    </CashModal>
  )
}

const HEADER_ALIASES: Record<string, string> = {
  "наименование": "name",
  "название": "name",
  "товар": "name",
  "nomi": "name",
  "name": "name",
  "артикул": "article",
  "штрих код": "barcode",
  "штрихкод": "barcode",
  "barcode": "barcode",
  "новая цена": "price",
  "yangi narx": "price",
  "new price": "price",
}

export function RepricingImportDialog({ rows, priceList, onClose, onImport }: { rows: RepricingPickRow[]; priceList: string; onClose: () => void; onImport: (lines: Array<{ row: RepricingPickRow; price: number }>) => void }) {
  const { t } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const template = () =>
    downloadExcelTable(`${t("Переоценка")} — ${priceList}`, [
      [t("Наименование"), t("Артикул"), t("Штрих-код"), t("Доступно"), t("Цена до"), t("Новая цена")],
      ...rows.map((row) => [row.name, row.article, row.barcode, row.available, row.price ?? "", ""]),
    ])

  async function submit() {
    if (!file) return
    setBusy(true)
    setError("")
    const sheet = await readExcelRows(file)
    setBusy(false)
    if (sheet.length < 2) return setError(t("Файл пустой"))
    const columns = mapHeaderColumns(sheet[0], HEADER_ALIASES)
    const column = (field: string) => [...columns].find(([, name]) => name === field)?.[0] ?? -1
    const priceColumn = Math.max(column("price"), sheet[0].findIndex((cell) => cell.trim().toLowerCase() === t("Новая цена").toLowerCase()))
    if (column("name") < 0 || priceColumn < 0) return setError(t("В файле нет колонок «Наименование» и «Новая цена»"))
    const lower = (value: string) => value.trim().toLowerCase()
    const byName = new Map(rows.map((row) => [lower(row.name), row]))
    const byArticle = new Map(rows.filter((row) => row.article).map((row) => [lower(row.article), row]))
    const byBarcode = new Map(rows.filter((row) => row.barcode).map((row) => [lower(row.barcode), row]))
    const lines: Array<{ row: RepricingPickRow; price: number }> = []
    const unknown: string[] = []
    for (const cells of sheet.slice(1)) {
      const raw = (cells[priceColumn] ?? "").replace(/\s/g, "").replace(",", ".")
      if (!raw) continue
      const price = Number(raw)
      const name = cells[column("name")] ?? ""
      const row = byName.get(lower(name)) ?? (column("article") >= 0 ? byArticle.get(lower(cells[column("article")] ?? "")) : undefined) ?? (column("barcode") >= 0 ? byBarcode.get(lower(cells[column("barcode")] ?? "")) : undefined)
      if (!row || !Number.isFinite(price) || price < 0) {
        unknown.push(name || raw)
        continue
      }
      lines.push({ row, price })
    }
    if (!lines.length) return setError(unknown.length ? `${t("Не найдены")}: ${unknown.slice(0, 5).join(", ")}` : t("В файле нет цен для загрузки"))
    onImport(lines)
  }

  return (
    <CashModal
      title={t("Импортировать c Excel")}
      onClose={onClose}
      size="sm"
      zIndex={170}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!file} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[14px]">
        <button type="button" onClick={template} disabled={!rows.length} className="self-start font-semibold text-[#4f71dc] hover:underline disabled:opacity-40">
          {t("Скачать шаблон")}
        </button>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
    </CashModal>
  )
}
