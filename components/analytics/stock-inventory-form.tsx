"use client"

import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, inputClass, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { MaterialAlert, MaterialDate, MaterialRadio } from "@/components/analytics/cash-material"
import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { InventoryImportDialog } from "@/components/analytics/stock-inventory-dialogs"
import { InventoryProductPicker } from "@/components/analytics/stock-inventory-picker"
import { diffColor, formatDiff, formatQty, formatSum } from "@/components/analytics/stock-inventory-shared"
import { downloadExcelTable } from "@/lib/excel-export"
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

export type InventoryLine = { key: string; name: string; unit: string; article: string; amount: string }

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
}: {
  /** null = "Добавить", a pending inventory = "Изменение". */
  inventory: StockInventoryDetail | null
  options: StockInventoryOptions | null
  onClose: () => void
  onSaved: (detail: StockInventoryDetail, created: boolean, message: string) => void
}) {
  const { t } = useLanguage()
  const editing = inventory !== null
  const [type, setType] = useState<StockInventoryType>(inventory?.type ?? "fact_date")
  const [warehouse, setWarehouse] = useState(inventory?.warehouse ?? "")
  const [invDate, setInvDate] = useState(inventory?.type === "custom_date" ? inventory.invDate : "")
  const [forDayEnd, setForDayEnd] = useState(inventory?.type === "custom_date" ? inventory.forDayEnd : false)
  // The reference form has no comment field; an edited document keeps the comment it already has.
  const [comment] = useState(inventory?.comment ?? "")
  const [lines, setLines] = useState<InventoryLine[]>(
    () => inventory?.items.map((item) => ({ key: item.key, name: item.name, unit: item.unit, article: item.article, amount: String(item.amount) })) ?? [],
  )
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
  const currency = options?.currency ?? inventory?.currency ?? "SUM"

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
        const index = next.findIndex((line) => line.key === row.key)
        if (index >= 0) next[index] = { ...next[index], amount }
        else added.push({ key: row.key, name: row.name, unit: row.unit, article: row.article, amount })
      }
      return [...added, ...next]
    })
    setError("")
  }

  const applyAddRow = () => {
    const row = balanceMap.get(addKey)
    if (!row || !validAmount(addAmount)) return
    upsertLines([{ row, amount: addAmount.trim() }])
    setAddKey("")
    setAddAmount("")
  }

  const downloadTemplate = () => {
    const header = [t("Наименование"), t("Артикул"), t("Ед. изм."), t("Остаток"), t("Факт. остаток")]
    downloadExcelTable(`${t("Инвентаризация")} ${warehouse}`, [header, ...balanceRows.map((row) => [row.name, row.article, row.unit, row.qty, ""])])
  }

  // One total per unit (pieces and kilograms are never added up): "52 870 dona, 9 846 kg".
  const totalQty = formatUnitTotals(
    lines.map((line) => ({ qty: parseAmount(line.amount), unit: line.unit })),
    t,
  )
  const totalSum = lines.reduce((sum, line) => {
    const row = balanceMap.get(line.key)
    return sum + (parseAmount(line.amount) - (row?.qty ?? 0)) * (row?.cost ?? 0)
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
      items: lines.map((line) => ({ key: line.key, amount: parseAmount(line.amount) })),
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
                {t("Общее кол-во:")} <b className="text-[16px] font-semibold text-[#129fdd]">{totalQty}</b>
              </span>
              <span>
                {t("Сумма")}: <b className="text-[16px] font-semibold" style={{ color: diffColor(totalSum) ?? "#129fdd" }}>{formatSum(totalSum, currency)}</b>
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
        <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] pt-[20px]">
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
              <div className="mt-3 flex h-[72px] items-start bg-[#f1f5f8] pl-[38px]">
                <RefSearchSelect
                  className="w-[432px]"
                  label={t("Наименование")}
                  searchable={false}
                  rowHeight={32}
                  labelShift={-3}
                  items={balanceRows.map((row) => ({ value: row.key, label: `${row.name} (${formatQty(row.qty, row.unit)})` }))}
                  selected={addKey ? [{ value: addKey, label: balanceMap.get(addKey)?.name ?? addKey }] : []}
                  loading={balances.loading}
                  onChange={(next) => setAddKey(next[0]?.value ?? "")}
                />
                <div className="ml-[18px] mt-[18px] flex w-[150px] items-center border-b border-[#e8e8e8]">
                  <input
                    value={addAmount}
                    inputMode="decimal"
                    placeholder={t("Факт. остаток")}
                    onChange={(event) => setAddAmount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        applyAddRow()
                      }
                    }}
                    className="h-9 min-w-0 flex-1 bg-transparent pt-2 text-[13px] outline-none placeholder:font-semibold placeholder:text-black"
                  />
                  <span className="text-[13px] text-black">{balanceMap.get(addKey)?.unit}</span>
                </div>
                <button
                  type="button"
                  disabled={!addKey || !validAmount(addAmount)}
                  onClick={applyAddRow}
                  title={t("Применить")}
                  aria-label={t("Применить")}
                  className="ml-[44px] mt-[29px] flex h-5 w-5 items-center justify-center text-[#4f71dc]"
                >
                  <Plus className="h-5 w-5" strokeWidth={1.6} />
                </button>
              </div>
            )}

            {lines.length ? (
              <div className="mt-3 max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[640px] border-collapse text-[14px]">
                  <thead>
                    <tr className="border-b border-[#e1e5eb] text-left font-semibold">
                      <th className="py-2.5 pr-3">{t("Наименование")}</th>
                      <th className="py-2.5 pr-3">{t("Серия")}</th>
                      <th className="py-2.5 pr-3 text-right">{t("Остаток")}</th>
                      <th className="py-2.5 pr-3">{t("Факт. остаток")}</th>
                      <th className="py-2.5 pr-3 text-right">{t("Разница")}</th>
                      <th className="w-10 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => {
                      const row = balanceMap.get(line.key)
                      const system = row?.qty ?? 0
                      const valid = validAmount(line.amount)
                      const diff = parseAmount(line.amount) - system
                      return (
                        <tr key={line.key} className="border-b border-dashed border-[#e1e5eb]">
                          <td className="py-2 pr-3">
                            {index + 1}. {line.name}
                            {line.article && <span className="block text-[12px] text-[#9aa3b6]">{line.article}</span>}
                          </td>
                          <td className="py-2 pr-3">-</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-right">{balances.data ? formatQty(system, line.unit) : "…"}</td>
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-2">
                              <input
                                value={line.amount}
                                inputMode="decimal"
                                aria-label={`${t("Факт. остаток")}: ${line.name}`}
                                onChange={(event) => {
                                  const amount = event.target.value
                                  setLines((current) => current.map((item) => (item.key === line.key ? { ...item, amount } : item)))
                                }}
                                className={`${inputClass} h-9 w-[120px] ${valid ? "" : "border-[#e57373]"}`}
                              />
                              <span>{line.unit}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold" style={{ color: valid ? diffColor(diff) : undefined }}>
                            {valid && balances.data ? formatDiff(diff, line.unit) : "-"}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                              title={t("Удалить")}
                              aria-label={t("Удалить")}
                              className="p-1 text-[#666] hover:text-[#e5484d]"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
