"use client"

import { useCallback, useMemo, useState, type CSSProperties } from "react"
import { Plus } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { MaterialAlert, MaterialDate, MaterialRadio } from "@/components/analytics/cash-material"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { InventoryImportDialog } from "@/components/analytics/stock-inventory-dialogs"
import { AmountField, balanceSeriesLoader } from "@/components/analytics/stock-inventory-edit"
import { InventoryProductPicker } from "@/components/analytics/stock-inventory-picker"
import { InventorySelect, type InventoryOption } from "@/components/analytics/stock-inventory-select"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_TYPES,
  STOCK_INVENTORY_TYPE_LABELS,
  type StockInventoryBalanceRow,
  type StockInventoryBalances,
  type StockInventoryDetail,
  type StockInventoryOptions,
  type StockInventoryType,
} from "@/lib/stock-inventories-types"

// Demo InventoryCreateDialog (module 4755) and the update form (4752):
// left — "Тип инвентаризации" (По факту проведения / На определенную дату),
// "Выберите склад", for a set date "Дата создания" + "Время инвентаризации"
// (На начало дня / На конец дня, with the demo hints) and a comment; right —
// "Список товаров" with "добавить из списка" (picker of the warehouse's system
// balances), "Добавить товар" (search row + Факт. остаток) and, when creating,
// "Импортировать c Excel" (template + upload). Changing the type, warehouse,
// date or time with lines asks first and clears them (demo confirm texts).

export type InventoryLine = { uid: number; key: string; name: string; unit: string; article: string; amount: string; series: InventoryOption | null }

let uids = 0

// Rows of Linko's dottedList: 2px dots every 8px under a row.
const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }

const START_HINT = "На начало дня- Инвентаризация будет сделана относительно остатков на начало выбранного дня . Изменения внесенные по инвентаризации запишутся на конец предыдущего дня "
const END_HINT = "На конец дня- Инвентаризация будет сделана относительно остатков на конец выбранного дня . Изменения внесутся на конец того дня который вы выбрали и с этим остатком начнется следующий календарный день"

const validAmount = (value: string) => {
  const text = value.replace(/[\s  ]/g, "").replace(",", ".")
  return text !== "" && Number.isFinite(Number(text)) && Number(text) >= 0
}

export function InventoryFormDialog({
  inventory,
  options,
  onClose,
  onSaved,
  initialWarehouse,
}: {
  /** null = "Добавить", a pending inventory = "Изменение". */
  inventory: StockInventoryDetail | null
  options: StockInventoryOptions | null
  onClose: () => void
  onSaved: (detail: StockInventoryDetail, created: boolean, message: string) => void
  /** Opt-in: the warehouse a new inventory starts with (a production stage's «Сверить» opens its own warehouse). */
  initialWarehouse?: string
}) {
  const { t } = useLanguage()
  const editing = inventory !== null
  const [type, setType] = useState<StockInventoryType>(inventory?.type ?? "fact_date")
  const [warehouse, setWarehouse] = useState(inventory?.warehouse ?? initialWarehouse ?? "")
  const [invDate, setInvDate] = useState(inventory?.type === "custom_date" ? inventory.invDate : "")
  const [forDayEnd, setForDayEnd] = useState(inventory?.type === "custom_date" ? inventory.forDayEnd : false)
  // Linko's create form has no comment (it is entered when confirming); an edited document keeps its own.
  const comment = inventory?.comment ?? ""
  const [lines, setLines] = useState<InventoryLine[]>(
    () => inventory?.items.map((item) => ({ uid: ++uids, key: item.key, name: item.name, unit: item.unit, article: item.article, amount: String(item.amount), series: null })) ?? [],
  )
  const [addSeries, setAddSeries] = useState<InventoryOption | null>(null)
  const [lineEdit, setLineEdit] = useState<{ uid: number; amount: string; series: InventoryOption | null } | null>(null)
  const [panel, setPanel] = useState<"none" | "add" | "excel">("none")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [ask, setAsk] = useState<{ title: string; apply: () => void } | null>(null)
  const [addKey, setAddKey] = useState("")
  const [addAmount, setAddAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const date = type === "fact_date" ? (inventory?.invDate ?? todayIso()) : invDate
  const dayEnd = type === "fact_date" ? true : forDayEnd
  const ready = Boolean(warehouse && date)
  const balances = useCashJson<StockInventoryBalances>(
    ready ? `/api/stock/inventories/balances?${buildCashQuery({ warehouse, date, forDayEnd: dayEnd ? "1" : "0" })}` : null,
  )
  const balanceRows = useMemo(() => balances.data?.rows ?? [], [balances.data])
  const balanceMap = useMemo(() => new Map(balanceRows.map((row) => [row.key, row])), [balanceRows])

  /** Header change: with lines, ask first (demo confirm) and clear them. */
  const change = (title: string, apply: () => void) => {
    if (!lines.length) return apply()
    setAsk({
      title,
      apply: () => {
        apply()
        setLines([])
        setPanel("none")
      },
    })
  }

  const upsertLines = (entries: Array<{ row: StockInventoryBalanceRow; amount: string }>) => {
    setLines((current) => {
      const next = [...current]
      const added: InventoryLine[] = []
      for (const { row, amount } of entries) {
        const index = next.findIndex((line) => line.key === row.key && !line.series)
        if (index >= 0) next[index] = { ...next[index], amount }
        else added.push({ uid: ++uids, key: row.key, name: row.name, unit: row.unit, article: row.article, amount, series: null })
      }
      return [...added, ...next]
    })
    setError("")
  }

  // Linko's add row: the line goes on top with no duplicate check (a product may come again with another series).
  const applyAddRow = () => {
    const row = balanceMap.get(addKey)
    if (!row || !validAmount(addAmount)) return
    setLines((current) => [{ uid: ++uids, key: row.key, name: row.name, unit: row.unit, article: row.article, amount: addAmount.trim(), series: row.trackExpiry ? addSeries : null }, ...current])
    setError("")
    setAddKey("")
    setAddAmount("")
    setAddSeries(null)
  }
  const applyEdit = () => {
    if (!lineEdit) return
    setLines((current) =>
      current.map((line) => (line.uid === lineEdit.uid ? { ...line, amount: lineEdit.amount.trim() ? lineEdit.amount.trim() : line.amount, series: lineEdit.series ?? line.series } : line)),
    )
    setLineEdit(null)
  }
  // «Наименование»: the warehouse's list in Linko's all_balances order, 50 at a time, searched by name / article.
  const loadProducts = useCallback(
    async (search: string) => {
      const needle = search.trim().toLowerCase()
      return balanceRows
        .filter((row) => !needle || row.name.toLowerCase().includes(needle) || row.article.toLowerCase().includes(needle))
        .slice(0, 50)
        .map((row) => ({ id: row.key, text: `${row.name} (${formatMoney(row.qty, 5)})`, data: row }))
    },
    [balanceRows],
  )
  const addRow = addKey ? (balanceMap.get(addKey) ?? null) : null

  const downloadTemplate = () => {
    const header = [t("Наименование"), t("Артикул"), t("Ед. изм."), t("Остаток"), t("Факт. остаток")]
    downloadExcelTable(`${t("Инвентаризация")} ${warehouse}`, [header, ...balanceRows.map((row) => [row.name, row.article, row.unit, row.qty, ""])])
  }

  // The value of the differences the count will book (Σ (counted − balance) × cost); a product on several lines (other
  // series) has its balance on its first line only, as the saved document.
  const counted = new Set<string>()
  const totalSum = [...lines].reverse().reduce((sum, line) => {
    const row = balanceMap.get(line.key)
    const balance = counted.has(line.key) ? 0 : (row?.qty ?? 0)
    counted.add(line.key)
    return sum + (parseAmount(line.amount) - balance) * (row?.cost ?? 0)
  }, 0)

  const submit = async () => {
    if (requireHeader()) return
    if (!lines.length) return setError(t("Вы еще не выбрали ни одного товара"))
    const bad = lines.find((line) => !validAmount(line.amount))
    if (bad) return setError(`${t("Введите количество")}: ${bad.name}`)
    setBusy(true)
    setError("")
    const body = {
      type,
      warehouse,
      invDate: type === "custom_date" ? invDate : undefined,
      forDayEnd: dayEnd,
      comment,
      items: lines.map((line) => ({ key: line.key, amount: parseAmount(line.amount), ...(typeof line.series?.id === "number" ? { seriesId: line.series.id } : {}) })),
    }
    const result = editing
      ? await cashMutate<StockInventoryDetail>("PUT", `/api/stock/inventories/${inventory.id}`, body)
      : await cashMutate<StockInventoryDetail>("POST", "/api/stock/inventories", body)
    setBusy(false)
    if (!result.ok) {
      const index = /^items\.(\d+)\./.exec(result.field ?? "")?.[1]
      const line = index === undefined ? null : lines[Number(index)]
      return setError(`${mutationError(result, t)}${line ? `: ${line.name}` : ""}`)
    }
    onSaved(result.data, !editing, "Успешно сохранено")
  }

  const requiredText = t("Это поле обязательно к заполнению")
  const [showErrors, setShowErrors] = useState(false)
  const [alertText, setAlertText] = useState("")
  const warehouseError = showErrors && !warehouse ? requiredText : ""
  const dateError = showErrors && type === "custom_date" && !invDate ? requiredText : ""
  /** Like the reference: an alert box plus the red message under the empty field. */
  const requireHeader = () => {
    if (ready) return false
    setShowErrors(true)
    setAlertText(`${!warehouse ? "stock" : "date"}: ${requiredText}`)
    return true
  }
  // Only active warehouses are offered; an edited document keeps its own warehouse even if it was deactivated since.
  const warehouseItems = [...new Set([...(options?.activeWarehouses ?? options?.warehouses ?? []), ...(inventory?.warehouse ? [inventory.warehouse] : [])])].map((name) => ({ value: name, label: name }))

  return (
    <>
      <CashModal
        title={editing ? `${t("Изменение")} №${inventory.id}` : t("Инвентаризация")}
        onClose={() => {
          // Escape inside the picker / import / confirm closes only that layer.
          if (!pickerOpen && !importOpen && !ask && !alertText) onClose()
        }}
        size="screen"
        footer={
          <>
            <div className="flex items-center gap-4 text-[14px] text-black">
              <span>
                {t("Сумма")}: <b className="text-[16px] font-semibold text-[#129fdd]">{formatMoney(totalSum)}</b>
              </span>
              {error && <span className="text-[13px] text-[#e57373]">{error}</span>}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50"
            >
              {editing ? t("Сохранить") : t("Добавить")}
            </button>
          </>
        }
      >
        <div className="w-[20%] min-w-[260px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] pb-[20px] pt-[20px]">
          <div className="text-[13px] leading-4 text-[#333]">{t("Тип инвентаризации")}</div>
          <div className="mt-px">
            {STOCK_INVENTORY_TYPES.map((value) => (
              <MaterialRadio
                key={value}
                checked={type === value}
                disabled={editing}
                label={t(STOCK_INVENTORY_TYPE_LABELS[value])}
                onChange={() => change(`${t("Вы уверены, что хотите сменить тип инвентаризации")}?`, () => setType(value))}
              />
            ))}
          </div>
          <RefSearchSelect
            className="mt-[3px]"
            dense
            label={t("Выберите склад")}
            required
            searchable={false}
            rowHeight={32}
            error={warehouseError}
            items={warehouseItems}
            selected={warehouse ? [{ value: warehouse, label: warehouse }] : []}
            onChange={(next) => {
              const value = next[0]?.value ?? ""
              if (value !== warehouse) change(`${t("Вы уверены, что хотите сменить склад")}?`, () => setWarehouse(value))
            }}
          />
          {type === "custom_date" ? (
            <>
              <MaterialDate
                label={t("Дата создания")}
                required
                value={invDate}
                max={todayIso()}
                error={dateError}
                onChange={(value) => change(`${t("Вы уверены, что хотите сменить дату")}?`, () => setInvDate(value))}
              />
              <div className="mt-[27px] text-[13px] leading-4 text-[#333]">{t("Время инвентаризации")}</div>
              <div className="mt-px">
                <MaterialRadio checked={!forDayEnd} label={t("На начало дня")} hint={t(START_HINT)} onChange={() => change(`${t("Вы уверены, что хотите сменить время")}?`, () => setForDayEnd(false))} />
                <MaterialRadio checked={forDayEnd} label={t("На конец дня")} hint={t(END_HINT)} onChange={() => change(`${t("Вы уверены, что хотите сменить время")}?`, () => setForDayEnd(true))} />
              </div>
            </>
          ) : (
            editing && (
              <div className="mt-[3px] text-[13px]">
                <span className="text-[10px] font-bold text-black">{t("Дата создания")}</span>
                <div className="mt-1 border-b border-[#e0e0e0] pb-2 text-black">{date}</div>
              </div>
            )
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-[30px] pt-[20px]">
          <div className="flex h-[34px] items-center justify-between">
            <strong className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</strong>
            <div className="flex items-center gap-[15px]">
              <button
                type="button"
                onClick={() => (requireHeader() ? undefined : balances.data && setPickerOpen(true))}
                className="mr-[16px] text-[13px] uppercase text-black hover:underline"
              >
                {t("добавить из списка")}
              </button>
              <button
                type="button"
                onClick={() => (requireHeader() ? undefined : setPanel(panel === "add" ? "none" : "add"))}
                className="inline-flex h-[34px] w-[160px] items-center rounded-sm bg-[rgb(79,113,220)] pl-3 pr-2 text-[13px] font-semibold text-white hover:brightness-95"
              >
                <Plus className="h-[18px] w-[18px] shrink-0" /> <span className="flex-1 text-center">{t("Добавить товар")}</span>
              </button>
              {!editing && (
                <button
                  type="button"
                  onClick={() => (requireHeader() ? undefined : setPanel(panel === "excel" ? "none" : "excel"))}
                  className="inline-flex h-[34px] w-[205px] items-center rounded-sm bg-[#71ce87] pl-3 pr-2 text-[13px] font-semibold text-white hover:brightness-95"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden>
                    <path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z" />
                  </svg>
                  <span className="flex-1 text-center">{t("Импортировать c Excel")}</span>
                </button>
              )}
            </div>
          </div>

          {ready && balances.error && <p className="mt-2 text-[13px] text-[#e57373]">{t(balances.error)}</p>}

            {ready && panel === "excel" && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-[#efefef] px-4 py-2">
                <button type="button" onClick={downloadTemplate} disabled={!balances.data} className="text-[13px] font-medium uppercase text-[rgb(129,199,132)] hover:underline disabled:opacity-50">
                  {t("1. Загрузить шаблон")}
                </button>
                <button type="button" onClick={() => setImportOpen(true)} className="text-[13px] font-medium uppercase text-[rgb(129,199,132)] hover:underline">
                  {t("2. Заполните excel и загрузите")}
                </button>
              </div>
            )}

            {ready && panel === "add" && (
              // Linko's add row (chunk 0 module 4768): Наименование 5 | Серия 3 (products that keep series) | Факт. остаток 2
              // + unit | + 1, on #f1f5f8.
              <div className="mt-[12px] grid h-[72px] grid-cols-12 items-end bg-[#f1f5f8] px-[30px] pb-[10px]">
                <div className="col-span-5 px-[8px]">
                  <InventorySelect<StockInventoryBalanceRow>
                    label={t("Наименование")}
                    value={addRow ? { id: addRow.key, text: addRow.name, data: addRow } : null}
                    load={loadProducts}
                    onChange={(next) => {
                      setAddKey(next ? String(next.id) : "")
                      setAddSeries(null)
                    }}
                  />
                </div>
                {addRow?.trackExpiry && (
                  <div className="col-span-3 px-[8px]">
                    <InventorySelect label={t("Серия")} value={addSeries} load={balanceSeriesLoader(addRow.productId ?? null, warehouse)} onChange={setAddSeries} />
                  </div>
                )}
                <div className="col-span-2 flex items-end px-[8px]">
                  <div className="min-w-0 flex-1">
                    <AmountField label={t("Факт. остаток")} value={addAmount} onChange={setAddAmount} onEnter={applyAddRow} />
                  </div>
                  {addRow?.unit && <span className="mb-[15px] ml-[6px] text-[13px]">{addRow.unit}</span>}
                </div>
                <div className="col-span-1 px-[8px]">
                  <button type="button" onClick={applyAddRow} title={t("Применить")} aria-label={t("Применить")} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-black/5">
                    <Plus className="h-6 w-6 text-[rgb(79,113,220)]" strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            )}

            {lines.length ? (
              // Linko's lines: Наименование 3 | Серия 3 | Остаток 1 | Факт. остаток 1 | Вес 1 | Вес нетто 1 | Разница 1 | ✎ 🗑 1.
              <div className="mt-[10px] p-[10px] text-[13px] leading-4 text-[#333]">
                <div className="relative -mx-[8px] grid grid-cols-12 items-center py-[15px] font-semibold [&>div]:px-[8px]">
                  <div className="col-span-3">{t("Наименование")}</div>
                  <div className="col-span-3">{t("Серия")}</div>
                  <div className="col-span-1">{t("Остаток")}</div>
                  <div className="col-span-1">{t("Факт. остаток")}</div>
                  <div className="col-span-1">{t("Вес")}</div>
                  <div className="col-span-1">{t("Вес нетто")}</div>
                  <div className="col-span-1">{t("Разница")}</div>
                  <div className="col-span-1" />
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />
                </div>
                {lines.map((line, index) => {
                  const row = balanceMap.get(line.key)
                  // A product on several lines keeps its balance on its first (lowest) line only, as the saved document.
                  const first = !lines.slice(index + 1).some((other) => other.key === line.key)
                  const system = first ? (row?.qty ?? 0) : 0
                  const amount = parseAmount(line.amount)
                  const diff = amount - system
                  const edit = lineEdit?.uid === line.uid ? lineEdit : null
                  return (
                    <div key={line.uid} className="relative -mx-[8px] grid min-h-[50px] grid-cols-12 items-center [&>div]:px-[8px]">
                      <div className="col-span-3 break-words">{line.name}</div>
                      <div className="col-span-3">
                        {edit && row?.trackExpiry ? (
                          <InventorySelect
                            ariaLabel={`${t("Серия")}: ${line.name}`}
                            value={edit.series ?? line.series}
                            load={balanceSeriesLoader(row.productId ?? null, warehouse)}
                            onChange={(next) => setLineEdit((current) => (current ? { ...current, series: next } : current))}
                          />
                        ) : (
                          line.series?.text ?? ""
                        )}
                      </div>
                      <div className="col-span-1">{balances.data ? formatMoney(system) : "…"}</div>
                      <div className="col-span-1">
                        {edit ? (
                          <input
                            value={edit.amount}
                            placeholder={line.amount}
                            inputMode="decimal"
                            aria-label={`${t("Факт. остаток")}: ${line.name}`}
                            onChange={(event) => setLineEdit((current) => (current ? { ...current, amount: event.target.value } : current))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault()
                                applyEdit()
                              }
                            }}
                            className="h-[36px] w-full border-b border-[#e0e0e0] bg-transparent outline-none"
                          />
                        ) : (
                          formatMoney(amount)
                        )}
                      </div>
                      <div className="col-span-1">{formatMoney((row?.weight ?? 0) * amount)}</div>
                      <div className="col-span-1">{formatMoney((row?.netWeight ?? 0) * amount)}</div>
                      <div className="col-span-1">
                        {balances.data ? `${diff > 0 ? "+" : ""}${formatMoney(diff)}` : "-"}
                      </div>
                      <div className="col-span-1 flex">
                        {edit ? (
                          <button type="button" onClick={applyEdit} aria-label={t("Применить")} className="flex h-[25px] w-[35px] items-center justify-center">
                            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[rgb(79,113,220)]" aria-hidden>
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          </button>
                        ) : (
                          <>
                            <button type="button" onClick={() => setLineEdit({ uid: line.uid, amount: "", series: null })} title={t("Изменить")} aria-label={t("Изменить")} className="flex h-[25px] w-[35px] items-center justify-center text-[#666]">
                              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden>
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => setLines((current) => current.filter((item) => item.uid !== line.uid))}
                              title={t("Удалить")}
                              aria-label={t("Удалить")}
                              className="flex h-[25px] w-[35px] items-center justify-center text-[#666]"
                            >
                              {/* Material "Delete forever" */}
                              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden>
                                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
      </CashModal>

      {alertText && <MaterialAlert message={alertText} onClose={() => setAlertText("")} />}

      {pickerOpen && balances.data && (
        <InventoryProductPicker
          balances={balances.data}
          type={type}
          initial={new Map(lines.map((line) => [line.key, line.amount]))}
          onClose={() => setPickerOpen(false)}
          onSubmit={(entries) => {
            upsertLines(entries)
            setPickerOpen(false)
          }}
        />
      )}

      {importOpen && (
        <InventoryImportDialog
          header={{ type, warehouse, invDate: type === "custom_date" ? invDate : undefined, forDayEnd: dayEnd, comment }}
          onClose={() => setImportOpen(false)}
          onDone={(detail) => {
            setImportOpen(false)
            onSaved(detail, true, "Продукты успешно добавлены")
          }}
        />
      )}

      {ask && (
        <ConfirmDialog
          title={ask.title}
          confirmLabel="Да"
          tone="blue"
          onConfirm={() => {
            ask.apply()
            setAsk(null)
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </>
  )
}
