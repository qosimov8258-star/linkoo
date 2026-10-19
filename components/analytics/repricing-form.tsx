"use client"

import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, FormField, PrimaryButton, SearchSelect, inputClass, parseAmount, useCashRates } from "@/components/analytics/cash-management-shared"
import { formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { mutateJson, mutationMessage } from "./price-lists-data"
import { RepricingImportDialog } from "./repricing-dialogs"
import { REPRICINGS_API, type RepricingCreateBody, type RepricingCreateResult, type RepricingErrorBody, type RepricingOptions, type RepricingPickRow } from "./repricing-data"

// Create dialog of "Переоценка" (demo c143 RevaluationForm 5207 + products 5208): title "Добавление";
// left Прайс лист*, Валюта*, "Оставить комментарий..." and "Создать переоценку для связанных
// прайс-листов" (when the list has linked lists); right "Список товаров" + "Импортировать c Excel",
// an add row (Наименование with "Доступно", Цена до, Новая цена, Сумма переоценки, Применить) and the
// lines Товар | Доступно | Цена до | Новая цена | Разница | Сумма до | Сумма после. Changing the
// price list or currency with lines asks "При изменении прайс листа или валюты, очистится список
// продуктов!". Saving finishes the repricing and applies the prices (POST /api/repricings).

type Line = { row: RepricingPickRow; price: string }

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
  const { codes } = useCashRates()
  const initialList = initial.priceListId ? String(initial.priceListId) : ""
  const [priceListId, setPriceListId] = useState(initialList)
  const [currency, setCurrency] = useState(initial.currency ? normCurrency(initial.currency) : "")
  const [comment, setComment] = useState("")
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [addKey, setAddKey] = useState("")
  const [addPrice, setAddPrice] = useState("")
  const [pending, setPending] = useState<{ field: "priceList" | "currency"; value: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const list = options?.priceLists.find((item) => String(item.id) === priceListId) ?? null
  // The currency defaults to the chosen list's currency.
  const effectiveCurrency = currency || (list ? list.currency : "")
  const picker = useCashJson<RepricingPickRow[]>(priceListId ? `${REPRICINGS_API}/products?${buildCashQuery({ priceList: priceListId })}` : null)
  const rows = useMemo(() => picker.data ?? [], [picker.data])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const ready = Boolean(priceListId && effectiveCurrency)
  const currencyOptions = [...new Set([...codes, ...(effectiveCurrency ? [effectiveCurrency] : [])])].map((code) => ({ value: code, label: currencyLabel(code) }))
  const listOptions = (options?.priceLists ?? []).filter((item) => item.isActive || String(item.id) === priceListId).map((item) => ({ value: String(item.id), label: item.name }))

  const change = (field: "priceList" | "currency", value: string) => {
    if (lines.length && value !== (field === "priceList" ? priceListId : effectiveCurrency)) return setPending({ field, value })
    apply(field, value)
  }
  function apply(field: "priceList" | "currency", value: string) {
    if (field === "priceList") {
      setPriceListId(value)
      const next = options?.priceLists.find((item) => String(item.id) === value)
      if (next && !currency) setCurrency(next.currency)
    } else setCurrency(value)
    setLines([])
    setAddKey("")
  }

  const addRow = rowMap.get(addKey)
  const oldPrice = (row: RepricingPickRow) => row.price ?? 0
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

  const cell = "py-2 pr-3"
  return (
    <CashModal
      title={t("Добавление")}
      onClose={onClose}
      size="full"
      footer={
        <>
          <span className="mr-auto text-[14px] text-[#586174]">
            {t("Сумма переоценки")}: <b className="text-[#17233b]">{formatSum(total, effectiveCurrency)}</b>
          </span>
          {error && <span className="text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-col gap-3 lg:w-[30%] lg:shrink-0 lg:border-r lg:border-[#efefef] lg:pr-6">
          <FormField label={t("Прайс лист")} required error={showErrors && !priceListId ? t("Это поле обязательно к заполнению") : undefined}>
            <SearchSelect value={priceListId} options={listOptions} invalid={showErrors && !priceListId} onChange={(value) => change("priceList", value)} />
          </FormField>
          <FormField label={t("Валюта")} required error={showErrors && !effectiveCurrency ? t("Это поле обязательно к заполнению") : undefined}>
            <SearchSelect value={effectiveCurrency} options={currencyOptions} invalid={showErrors && !effectiveCurrency} onChange={(value) => change("currency", value)} />
          </FormField>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={2000} placeholder={`${t("Оставить комментарий")}...`} className={`${inputClass} h-auto py-2`} />
          {(list?.dependents ?? 0) > 0 && (
            <label className="flex items-start gap-3 text-[14px] text-[#17233b]">
              <input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4f71dc]" />
              <span>
                {t("Создать переоценку для связанных прайс-листов")} ({list?.dependents})
              </span>
            </label>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong>{t("Список товаров")}</strong>
            <button
              type="button"
              onClick={() => (ready ? setImportOpen(true) : setShowErrors(true))}
              className="text-[13px] lowercase text-[rgb(79,113,220)] hover:underline"
            >
              {t("Импортировать c Excel")}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 items-end gap-3 bg-[#f1f5f8] px-4 pb-3 pt-2 md:grid-cols-[minmax(0,1fr)_120px_140px_140px_auto]" title={ready ? undefined : t("Выберите прайс лист и валюту")}>
            <FormField label={t("Наименование")}>
              <SearchSelect
                value={addKey}
                disabled={!ready}
                loading={picker.loading}
                options={rows.map((row) => ({ value: row.key, label: row.name, hint: `${t("Доступно")}: ${formatQty(row.available, row.unit)}` }))}
                onChange={(value) => setAddKey(value)}
              />
            </FormField>
            <span className="pb-2.5 text-[13px] text-[#586174]">{addRow ? formatSum(oldPrice(addRow), addRow.currency) : ""}</span>
            <FormField label={t("Новая цена")}>
              <input value={addPrice} disabled={!ready} inputMode="decimal" onChange={(event) => setAddPrice(event.target.value)} onKeyDown={(event) => event.key === "Enter" && add()} className={inputClass} />
            </FormField>
            <span className="pb-2.5 text-[13px] text-[#586174]">{addRow && valid(addPrice) ? formatSum((parseAmount(addPrice) - oldPrice(addRow)) * addRow.available, effectiveCurrency) : ""}</span>
            <button type="button" onClick={add} disabled={!addRow || !valid(addPrice)} title={t("Применить")} aria-label={t("Применить")} className="flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(79,113,220)] text-white disabled:opacity-40">
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {picker.error && <p className="mt-2 text-[13px] text-[#e57373]">{t(picker.error)}</p>}
          {lines.length ? (
            <div className="mt-3 max-h-[52vh] overflow-auto">
              <table className="w-full min-w-[820px] border-collapse text-[14px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-[#e1e5eb] text-left font-semibold">
                    <th className={cell}>{t("Товар")}</th>
                    <th className={cell}>{t("Доступно")}</th>
                    <th className={cell}>{t("Цена до")}</th>
                    <th className={cell}>{t("Новая цена")}</th>
                    <th className={cell}>{t("Разница")}</th>
                    <th className={cell}>{t("Сумма до")}</th>
                    <th className={cell}>{t("Сумма после")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const price = parseAmount(line.price)
                    const bad = !valid(line.price)
                    return (
                      <tr key={line.row.key} className="border-b border-dashed border-[#e1e5eb]">
                        <td className={cell}>{line.row.name}</td>
                        <td className={`${cell} whitespace-nowrap`}>{formatQty(line.row.available, line.row.unit)}</td>
                        <td className={`${cell} whitespace-nowrap`}>{formatSum(oldPrice(line.row), line.row.currency)}</td>
                        <td className={cell}>
                          <span className="flex items-center gap-1.5">
                            <input
                              value={line.price}
                              inputMode="decimal"
                              aria-label={`${t("Новая цена")}: ${line.row.name}`}
                              onChange={(event) => setLines((current) => current.map((item, i) => (i === index ? { ...item, price: event.target.value } : item)))}
                              className={`h-9 w-[110px] border-b bg-transparent px-1 outline-none ${bad && showErrors ? "border-[#e57373] text-[#e57373]" : "border-[#5d6474]"}`}
                            />
                            <span className="text-[#586174]">{currencyLabel(effectiveCurrency)}</span>
                          </span>
                        </td>
                        <td className={`${cell} whitespace-nowrap`} style={{ color: !bad && price < oldPrice(line.row) ? "#e57373" : undefined }}>
                          {bad ? "—" : formatSum(lineDiff(line), effectiveCurrency)}
                        </td>
                        <td className={`${cell} whitespace-nowrap`}>{formatSum(oldPrice(line.row) * line.row.available, line.row.currency)}</td>
                        <td className={`${cell} whitespace-nowrap`}>{bad ? "—" : formatSum(price * line.row.available, effectiveCurrency)}</td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="text-[#9aa3b6] hover:text-[#e57373]">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-16 text-center text-[13px] text-[#9aa3b6]">{ready ? t("Товаров нет") : t("Выберите прайс лист и валюту")}</p>
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
            apply(pending.field, pending.value)
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
