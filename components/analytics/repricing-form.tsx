"use client"

import { Check } from "lucide-react"
import { useMemo, useState } from "react"

import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import { MaterialCheckbox } from "@/components/analytics/cash-material"
import { CashModal, ConfirmDialog, FormField, SearchSelect, inputClass, parseAmount, useCashRates } from "@/components/analytics/cash-management-shared"
import { formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { convertAmount, currencyLabel, normCurrency } from "@/lib/finance/currency"
import { amountDigits, printDigits } from "@/lib/amount-precision"
import { useLanguage } from "@/lib/i18n/language-context"
import { mutateJson, mutationMessage } from "./price-lists-data"
import { RepricingImportDialog } from "./repricing-dialogs"
import { REPRICINGS_API, type RepricingCreateBody, type RepricingCreateResult, type RepricingErrorBody, type RepricingOptions, type RepricingPickRow } from "./repricing-data"

// Create dialog of "Переоценка" (demo c143 RevaluationForm 5207 + products 5208): title "Добавление";
// left Прайс лист*, Валюта*, "Оставить комментарий..." and "Создать переоценку для связанных
// прайс-листов" (when the list has linked lists); right "Список товаров" + "Импортировать c Excel",
// an add row (Наименование with "Доступно", Цена до, Новая цена, Сумма переоценки, Применить) and the
// lines Наименование | Цена до | Цена после | Сумма переоценки with ✎ / 🗑 (Linko's table). Changing the
// price list with lines asks "При изменении прайс листа или валюты, очистится список продуктов!".
// Валюта starts as the price list's currency and may be another one (Linko's Euro / SUM / USD): the new
// prices are written in it and every sum is in it; an old price is compared through its list-currency
// value (RepricingPickRow.listPrice) converted with the current rates. Saving finishes the repricing and applies
// the prices (POST /api/repricings).

type Line = { row: RepricingPickRow; price: string }

// Linko's line table (the right 1 060 px at 1600 px wide): Наименование 376 | Цена до 172 | Цена после 172 |
// Сумма переоценки 172 | ✎ 🗑.
const LINE_GRID = "grid grid-cols-[minmax(0,376fr)_minmax(0,172fr)_minmax(0,172fr)_minmax(0,172fr)_minmax(0,168fr)] items-center"

/** Linko's numberFormat without a currency (its line table prints the bare numbers), Округление сумм decimals. */
const formatAmount = (value: number) => printDigits(value, amountDigits(3))

const valid = (value: string) => value.trim() !== "" && Number.isFinite(Number(value.replace(/\s/g, "").replace(",", "."))) && parseAmount(value) >= 0

export function RepricingFormDialog({
  initial,
  options,
  onClose,
  onSaved,
}: {
  initial: { priceListId: number | null; currency: string }
  options: RepricingOptions | null
  onClose: () => void
  onSaved: (result: RepricingCreateResult) => void
}) {
  const { t } = useLanguage()
  const initialList = initial.priceListId ? String(initial.priceListId) : ""
  const [priceListId, setPriceListId] = useState(initialList)
  const [comment, setComment] = useState("")
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [addKey, setAddKey] = useState("")
  const [addPrice, setAddPrice] = useState("")
  // A price list or currency change asked about while the form has lines.
  const [pending, setPending] = useState<{ kind: "list" | "currency"; value: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [editPrice, setEditPrice] = useState("")
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const list = options?.priceLists.find((item) => String(item.id) === priceListId) ?? null
  // Валюта (Linko: Euro / SUM / USD): the list's currency until another one is chosen; the new prices are in it.
  const [currencyChoice, setCurrencyChoice] = useState("")
  const { rates, codes } = useCashRates()
  const listCurrency = list ? normCurrency(list.currency) : ""
  const effectiveCurrency = list ? normCurrency(currencyChoice || listCurrency) : ""
  const picker = useCashJson<RepricingPickRow[]>(priceListId ? `${REPRICINGS_API}/products?${buildCashQuery({ priceList: priceListId })}` : null)
  const rows = useMemo(() => picker.data ?? [], [picker.data])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const ready = Boolean(priceListId && effectiveCurrency)
  const currencyOptions = [...new Set([...codes, ...(listCurrency ? [listCurrency] : [])])].map((code) => ({ value: code, label: currencyLabel(code) }))
  const listOptions = (options?.priceLists ?? []).filter((item) => item.isActive || String(item.id) === priceListId).map((item) => ({ value: String(item.id), label: item.name }))

  const change = (value: string) => {
    if (lines.length && value !== priceListId) return setPending({ kind: "list", value })
    apply(value)
  }
  function apply(value: string) {
    setPriceListId(value)
    setCurrencyChoice("")
    setLines([])
    setAddKey("")
    setAddPrice("")
  }
  // Linko's warning covers the currency too: the typed prices were in the old one.
  const changeCurrency = (value: string) => {
    if (value === effectiveCurrency) return
    if (lines.length) return setPending({ kind: "currency", value })
    applyCurrency(value)
  }
  function applyCurrency(value: string) {
    setCurrencyChoice(value)
    setLines([])
    setAddKey("")
    setAddPrice("")
  }

  const addRow = rowMap.get(addKey)
  // Old price in the document currency (row.listPrice is in the list's currency; the entry may be kept in another
  // one); 0 when there is none or no rate converts it.
  const oldPrice = (row: RepricingPickRow) => {
    const price = row.listPrice ?? 0
    return listCurrency && effectiveCurrency !== listCurrency ? (convertAmount(price, listCurrency, effectiveCurrency, rates) ?? 0) : price
  }
  const oldLabel = (row: RepricingPickRow) => (row.price === null ? "—" : formatSum(row.price, row.currency))
  const lineDiff = (line: Line) => (parseAmount(line.price) - oldPrice(line.row)) * line.row.available
  const total = lines.reduce((sum, line) => sum + (valid(line.price) ? lineDiff(line) : 0), 0)

  function add() {
    if (!addRow || !valid(addPrice)) return
    setLines((current) => [{ row: addRow, price: addPrice.trim() }, ...current.filter((line) => line.row.key !== addRow.key)])
    setAddKey("")
    setAddPrice("")
    setError("")
  }

  async function submit() {
    setShowErrors(true)
    setError("")
    if (!priceListId || !effectiveCurrency) return setError(t("Это поле обязательно к заполнению"))
    if (!lines.length) return setError(t("Добавьте товары"))
    if (lines.some((line) => !valid(line.price))) return setError(t("Укажите новую цену"))
    const body: RepricingCreateBody = {
      priceListId: Number(priceListId),
      currency: effectiveCurrency,
      comment: comment.trim(),
      connected: connected && (list?.dependents ?? 0) > 0,
      products: lines.map((line) => ({ kind: line.row.kind, id: line.row.id, price: parseAmount(line.price) })),
    }
    setBusy(true)
    const result = await mutateJson<RepricingCreateResult>("POST", REPRICINGS_API, body)
    setBusy(false)
    if (!result.ok) {
      const missing = (result.body as RepricingErrorBody | null)?.missing ?? []
      return setError(`${t(mutationMessage(result))}${missing.length ? `: ${missing.map((key) => rowMap.get(key)?.name ?? key).join(", ")}` : ""}`)
    }
    onSaved(result.data)
  }

  /** ✎ of a line: «Цена после» becomes a field; ✓ (or Enter) keeps a valid new price, an empty one keeps the old. */
  function finishEdit(index: number) {
    const value = editPrice.trim()
    if (value && valid(value)) setLines((current) => current.map((line, i) => (i === index ? { ...line, price: value } : line)))
    setEditIndex(null)
    setEditPrice("")
  }
  return (
    <CashModal
      title={t("Добавление")}
      onClose={onClose}
      closeInset={6}
      size="screen"
      footer={
        <>
          {lines.length > 0 && (
            <span className="pl-[15px] text-[14px] text-black">
              {t("Сумма переоценки")}: <b className="font-semibold text-[#0e9fe0]">{formatSum(total, effectiveCurrency)}</b>
            </span>
          )}
          {error && <span className="ml-auto mr-4 text-[13px] text-[#f44336]">{error}</span>}
          <button type="button" disabled={busy} onClick={() => void submit()} className={`${error ? "" : "ml-auto "}mr-[16px] h-9 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:opacity-60`}>
            {t("Сохранить")}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        {/* Linko (#/revaluation/?openCreateDialog=true at 1600 px): a 480 px form column, the products from x = 480. */}
        <div className="flex w-[480px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[#efefef] px-[30px] pb-6 pt-[30px]">
          <FormField label={t("Прайс лист")} required showRequired semibold error={showErrors && !priceListId ? t("Это поле обязательно к заполнению") : undefined}>
            <SearchSelect value={priceListId} options={listOptions} invalid={showErrors && !priceListId} onChange={change} />
          </FormField>
          <FormField label={t("Валюта")} required showRequired semibold>
            <SearchSelect value={effectiveCurrency} options={currencyOptions} disabled={!list} allowClear={false} onChange={changeCurrency} />
          </FormField>
          <FormField label={`${t("Оставить комментарий")}...`} semibold>
            <input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} className={inputClass} />
          </FormField>
          {(list?.dependents ?? 0) > 0 && <MaterialCheckbox checked={connected} onChange={setConnected} label={`${t("Создать переоценку для связанных прайс-листов")} (${list?.dependents})`} />}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 px-[30px] pt-[10px]">
            <span className="text-[13px] font-semibold text-black">{t("Список товаров")}</span>
            <button
              type="button"
              onClick={() => (ready ? setImportOpen(true) : setShowErrors(true))}
              // Linko: a grey (disabled) button until the price list and currency are chosen, then a flat one.
              className={`h-9 rounded-[3px] px-4 text-[13px] lowercase text-black ${ready ? "bg-transparent hover:bg-[#eee]" : "bg-[#eee]"}`}
            >
              {t("Импортировать c Excel")}
            </button>
          </div>
          <div className="mt-[10px] grid grid-cols-1 items-end bg-[#f0f4f7] px-[38px] pb-[18px] pt-[8px] md:grid-cols-[minmax(0,49fr)_minmax(0,10fr)_minmax(0,15.4fr)_minmax(0,10.4fr)_minmax(0,15.2fr)]">
            <FormField label={t("Наименование")} semibold className="bg-[#fafafa]">
              <SearchSelect
                value={addKey}
                disabled={!ready}
                loading={picker.loading}
                options={rows.map((row) => ({ value: row.key, label: row.name, hint: `${t("Доступно")}: ${formatQty(row.available, row.unit)}` }))}
                onChange={(value) => setAddKey(value)}
              />
            </FormField>
            <span className="pb-2.5 text-[13px] text-[#586174]">{addRow ? oldLabel(addRow) : ""}</span>
            <FormField label={t("Новая цена")} semibold>
              <input value={addPrice} disabled={!ready} inputMode="decimal" onChange={(event) => setAddPrice(event.target.value)} onKeyDown={(event) => event.key === "Enter" && add()} className={inputClass} />
            </FormField>
            {/* Linko shows the sum as soon as a product is picked (an empty new price counts as 0). */}
            <span className="pb-2.5 text-[13px] text-[#586174]">{addRow && (!addPrice.trim() || valid(addPrice)) ? formatSum(((addPrice.trim() ? parseAmount(addPrice) : 0) - oldPrice(addRow)) * addRow.available, effectiveCurrency) : ""}</span>
            <button type="button" onClick={add} title={t("Применить")} aria-label={t("Применить")} className="flex h-10 w-10 items-center justify-center text-[#1E4A9A]">
              <Check className="h-6 w-6" strokeWidth={2} />
            </button>
          </div>
          {picker.error && <p className="mt-2 text-[13px] text-[#e57373]">{t(picker.error)}</p>}
          {lines.length ? (
            // Linko's table of the chosen products: Наименование | Цена до | Цена после | Сумма переоценки, the
            // prices as bare numbers in the document currency; ✎ turns «Цена после» into a field (✓ keeps it), 🗑 drops
            // the line.
            <div className="mx-[30px] mt-[6px] max-h-[52vh] overflow-auto text-[13px] text-[#333]">
              <div className={`${LINE_GRID} h-[48px] font-semibold`}>
                <span>{t("Наименование")}</span>
                <span>{t("Цена до")}</span>
                <span>{t("Цена после")}</span>
                <span>{t("Сумма переоценки")}</span>
                <span />
              </div>
              {lines.map((line, index) => {
                const bad = !valid(line.price)
                const editing = editIndex === index
                return (
                  <div key={line.row.key} className={`${LINE_GRID} min-h-[48px] border-b border-[#e0e0e0]`}>
                    <span className="pl-[5px] pr-3">{line.row.name}</span>
                    <span>{formatAmount(oldPrice(line.row))}</span>
                    {editing ? (
                      <input
                        autoFocus
                        value={editPrice}
                        inputMode="decimal"
                        placeholder={line.price}
                        aria-label={`${t("Цена после")}: ${line.row.name}`}
                        onChange={(event) => setEditPrice(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), finishEdit(index))}
                        className="mr-4 h-9 border-b border-[#5d6474] bg-transparent outline-none"
                      />
                    ) : (
                      <span className={bad && showErrors ? "text-[#e57373]" : undefined}>{bad ? line.price || "—" : formatAmount(parseAmount(line.price))}</span>
                    )}
                    <span style={{ color: !bad && parseAmount(line.price) < oldPrice(line.row) ? "#e57373" : undefined }}>{bad ? "—" : formatAmount(lineDiff(line))}</span>
                    <span className="flex items-center justify-end">
                      {editing ? (
                        <button type="button" onClick={() => finishEdit(index)} aria-label={t("Применить")} className="flex h-12 w-12 items-center justify-center text-[rgb(79,113,220)]">
                          <Check className="h-6 w-6" strokeWidth={2} />
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setEditIndex(index); setEditPrice("") }} aria-label={t("Изменить")} className="flex h-12 w-12 items-center justify-center text-[#666]">
                            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                          </button>
                          <button type="button" onClick={() => { setLines((current) => current.filter((_, i) => i !== index)); setEditIndex(null) }} aria-label={t("Удалить")} className="flex h-12 w-12 items-center justify-center text-[#666]">
                            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            ready ? <p className="py-16 text-center text-[13px] text-[#9aa3b6]">{t("Товаров нет")}</p> : null
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          title={t("Подтверждение")}
          text={t("При изменении прайс листа или валюты, очистится список продуктов!")}
          confirmLabel="Подтвердить"
          tone="blue"
          onConfirm={() => {
            if (pending.kind === "list") apply(pending.value)
            else applyCurrency(pending.value)
            setPending(null)
          }}
          onClose={() => setPending(null)}
        />
      )}
      {importOpen && list && (
        <RepricingImportDialog
          rows={rows}
          priceList={list.name}
          onClose={() => setImportOpen(false)}
          onImport={(imported) => {
            setLines((current) => [...imported.map((item) => ({ row: item.row, price: String(item.price) })), ...current.filter((line) => !imported.some((item) => item.row.key === line.row.key))])
            setImportOpen(false)
          }}
        />
      )}
    </CashModal>
  )
}
