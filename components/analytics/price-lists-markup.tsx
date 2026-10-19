"use client"

import { useState } from "react"

import { CashModal, FormField, PrimaryButton, SearchSelect, inputClass } from "@/components/analytics/cash-management-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { PRICE_ROUND_STEPS, roundPriceUp, type PriceGridKind, type PriceGridResult, type PriceGridRow } from "./price-lists-data"

// Helpers of the set-price grid: the "Наценка" dialog (demo PriceEvaluationForm, c9 module 4844:
// per price list "Процент от нал." / "Округ нал." / "Процент от пер." / "Округ пер.") that fills the
// grid from the items' cost, and the Excel template / import (demo export_example + import).

export type GridList = { id: number; name: string; currency: string }
export type GridMode = { twoColumns: boolean; withLimits: boolean }
export type MarkupRule = { cashPercent: string; cashRound: string; bankPercent: string; bankRound: string }

const number = (value: string) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : NaN
}

/** Price from cost + markup percent, rounded up to the step; null when the cost or percent is missing. */
export function markupPrice(cost: number, percent: string, round: string): number | null {
  const value = number(percent)
  if (!(cost > 0) || !percent.trim() || !Number.isFinite(value)) return null
  return roundPriceUp(cost * (1 + value / 100), Number(round) || 0)
}

export function MarkupDialog({ lists, mode, onClose, onApply }: { lists: GridList[]; mode: GridMode; onClose: () => void; onApply: (rules: Record<number, MarkupRule>) => Promise<string> }) {
  const { t } = useLanguage()
  const [rules, setRules] = useState<Record<number, MarkupRule>>(() => Object.fromEntries(lists.map((list) => [list.id, { cashPercent: "", cashRound: "", bankPercent: "", bankRound: "" }])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const set = (id: number, patch: Partial<MarkupRule>) => setRules((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const roundOptions = PRICE_ROUND_STEPS.map((step) => ({ value: String(step), label: String(step) }))
  const invalid = Object.values(rules).some((rule) => [rule.cashPercent, rule.bankPercent].some((value) => value.trim() && !Number.isFinite(number(value))))

  return (
    <CashModal
      title={t("Наценка")}
      onClose={onClose}
      size="lg"
      zIndex={170}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{t(error)}</span>}
          <PrimaryButton
            busy={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true)
              setError(await onApply(rules))
              setBusy(false)
            }}
          >
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-[#586174]">{t("Цена = себестоимость + наценка, с округлением вверх. Товары без себестоимости пропускаются.")}</p>
      <div className="flex flex-col gap-4">
        {lists.map((list) => (
          <div key={list.id} className="grid grid-cols-1 items-end gap-3 border-b border-dashed border-[#e1e5eb] pb-4 sm:grid-cols-[180px_repeat(4,minmax(0,1fr))]">
            <b className="pb-2 text-[#17233b]">{list.name}</b>
            <FormField label={t("Процент от нал.")}>
              <input value={rules[list.id].cashPercent} inputMode="decimal" onChange={(event) => set(list.id, { cashPercent: event.target.value })} className={inputClass} />
            </FormField>
            <FormField label={t("Округ нал.")}>
              <SearchSelect value={rules[list.id].cashRound} options={roundOptions} onChange={(cashRound) => set(list.id, { cashRound })} />
            </FormField>
            {mode.twoColumns && (
              <>
                <FormField label={t("Процент от пер.")}>
                  <input value={rules[list.id].bankPercent} inputMode="decimal" onChange={(event) => set(list.id, { bankPercent: event.target.value })} className={inputClass} />
                </FormField>
                <FormField label={t("Округ пер.")}>
                  <SearchSelect value={rules[list.id].bankRound} options={roundOptions} onChange={(bankRound) => set(list.id, { bankRound })} />
                </FormField>
              </>
            )}
          </div>
        ))}
      </div>
    </CashModal>
  )
}

// --- Excel ---

type Translate = (text: string) => string

const KIND_LABEL: Record<PriceGridKind, string> = { product: "Продукт", raw_material: "Сырье" }

function columnTitles(list: GridList, mode: GridMode, t: Translate): string[] {
  return [
    `${list.name} (${t("Нал")})`,
    ...(mode.twoColumns ? [`${list.name} (${t("Безнал")})`] : []),
    ...(mode.withLimits ? [`${list.name} (${t("Мин")})`, `${list.name} (${t("Макс")})`] : []),
  ]
}

/** Template with the current prices of the chosen lists (demo price_list_item/export_example/). */
export function downloadPriceTemplate(result: PriceGridResult, lists: GridList[], mode: GridMode, t: Translate) {
  const header = ["ID", t("Тип"), t("Наименование"), t("Артикул"), t("Штрих-код"), ...lists.flatMap((list) => columnTitles(list, mode, t))]
  const rows = result.results.map((row) => [
    row.id,
    t(KIND_LABEL[row.kind]),
    row.name,
    row.article,
    row.barcode,
    ...lists.flatMap((list) => {
      const entry = row.prices[String(list.id)]
      return [entry?.cash ?? "", ...(mode.twoColumns ? [entry?.nonCash ?? ""] : []), ...(mode.withLimits ? [entry?.min ?? "", entry?.max ?? ""] : [])]
    }),
  ])
  downloadExcelTable(t("Установить цену в прайс-лист"), [header, ...rows])
}

export type ImportedPrice = { kind: PriceGridKind; id: number; prices: Array<{ priceListId: number; cash?: number; nonCash?: number; min?: number; max?: number }> }

/** Reads the filled template: items by Тип + ID (else by name), one price per filled cell. */
export async function readPriceTemplate(file: File, catalog: PriceGridRow[], lists: GridList[], mode: GridMode, t: Translate): Promise<{ rows: ImportedPrice[]; unknown: string[] }> {
  const sheet = await readExcelRows(file)
  if (sheet.length < 2) return { rows: [], unknown: [] }
  const header = sheet[0].map((cell) => cell.trim().toLowerCase())
  const index = (title: string) => header.indexOf(title.trim().toLowerCase())
  const idColumn = index("ID")
  const kindColumn = index(t("Тип"))
  const nameColumn = index(t("Наименование"))
  const byKey = new Map(catalog.map((row) => [row.key, row]))
  const byName = new Map(catalog.map((row) => [row.name.trim().toLowerCase(), row]))
  const kindOf = (value: string): PriceGridKind => (value.trim().toLowerCase() === t(KIND_LABEL.raw_material).toLowerCase() || value === "raw_material" ? "raw_material" : "product")
  const value = (cells: string[], title: string) => {
    const position = index(title)
    if (position < 0) return undefined
    const parsed = number(cells[position] ?? "")
    return (cells[position] ?? "").trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  const rows: ImportedPrice[] = []
  const unknown: string[] = []
  for (const cells of sheet.slice(1)) {
    const id = idColumn >= 0 ? Number(cells[idColumn]) : NaN
    const name = nameColumn >= 0 ? (cells[nameColumn] ?? "").trim() : ""
    const item = (Number.isInteger(id) && id > 0 ? byKey.get(`${kindOf(kindColumn >= 0 ? (cells[kindColumn] ?? "") : "")}:${id}`) : undefined) ?? byName.get(name.toLowerCase())
    if (!item) {
      if (name || cells.some(Boolean)) unknown.push(name || String(cells[idColumn] ?? ""))
      continue
    }
    const prices = lists.flatMap((list) => {
      const [cashTitle, ...rest] = columnTitles(list, mode, t)
      const cash = value(cells, cashTitle)
      const nonCash = mode.twoColumns ? value(cells, rest[0]) : cash
      const min = mode.withLimits ? value(cells, rest[mode.twoColumns ? 1 : 0]) : undefined
      const max = mode.withLimits ? value(cells, rest[mode.twoColumns ? 2 : 1]) : undefined
      return cash === undefined && nonCash === undefined && min === undefined && max === undefined ? [] : [{ priceListId: list.id, cash, nonCash, min, max }]
    })
    if (prices.length) rows.push({ kind: item.kind, id: item.id, prices })
  }
  return { rows, unknown }
}
