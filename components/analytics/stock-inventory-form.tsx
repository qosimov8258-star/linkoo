"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Check, FileSpreadsheet, Info, Plus, Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, FormField, PrimaryButton, SearchSelect, inputClass, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
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

function Radio({ checked, disabled, label, onChange, hint }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void; hint?: string }) {
  return (
    <label className={`flex items-center gap-2 py-1 text-[14px] ${disabled ? "cursor-not-allowed text-[#9aa3b6]" : "cursor-pointer text-[#17233b]"}`}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} className="h-4 w-4 accent-[rgb(79,113,220)]" />
      <span className="flex-1">{label}</span>
      {hint && (
        <span title={hint} className="text-[#4f71dc]">
          <Info className="h-4 w-4" />
        </span>
      )}
    </label>
  )
}

function Hint({ text, children }: { text: string | null; children: ReactNode }) {
  return (
    <span title={text ?? undefined} className="inline-flex">
      {children}
    </span>
  )
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
  const [comment, setComment] = useState(inventory?.comment ?? "")
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
    if (!warehouse) return setError(t("Выберите склад"))
    if (type === "custom_date" && !invDate) return setError(t("Укажите дату"))
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

  const needsDateText = type === "custom_date" ? t("Выберите склад и дату") : t("Выберите склад")
  const linkButton = "text-[13px] font-medium uppercase text-[rgb(79,113,220)] hover:underline disabled:cursor-not-allowed disabled:text-[#9aa3b6] disabled:no-underline"
  const colorButton = "inline-flex h-[34px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"

  return (
    <>
      <CashModal
        title={editing ? `${t("Изменение")} №${inventory.id}` : t("Инвентаризация")}
        onClose={() => {
          // Escape inside the picker / import / confirm closes only that layer.
          if (!pickerOpen && !importOpen && !ask) onClose()
        }}
        size="full"
        footer={
          <>
            <div className="mr-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px]">
              <span>
                {t("Общее кол-во:")} <b className="text-[16px] text-[#129fdd]">{totalQty}</b>
              </span>
              <span>
                {t("Сумма")}: <b className="text-[16px]" style={{ color: diffColor(totalSum) ?? "#129fdd" }}>{formatSum(totalSum, currency)}</b>
              </span>
              {error && <span className="text-[13px] text-[#e57373]">{error}</span>}
            </div>
            <PrimaryButton busy={busy} onClick={() => void submit()}>
              {editing ? t("Сохранить") : t("Добавить")}
            </PrimaryButton>
          </>
        }
      >
        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="flex flex-col gap-3 lg:w-[300px] lg:shrink-0 lg:border-r lg:border-[#efefef] lg:pr-6">
            <div>
              <div className="text-[13px] text-[#586174]">{t("Тип инвентаризации")}</div>
              {STOCK_INVENTORY_TYPES.map((value) => (
                <Radio
                  key={value}
                  checked={type === value}
                  disabled={editing}
                  label={t(STOCK_INVENTORY_TYPE_LABELS[value])}
                  onChange={() => change(`${t("Вы уверены, что хотите сменить тип инвентаризации")}?`, () => setType(value))}
                />
              ))}
            </div>
            <FormField label={t("Выберите склад")} required>
              <SearchSelect
                value={warehouse}
                options={[...new Set([...(options?.activeWarehouses ?? options?.warehouses ?? []), ...(inventory?.warehouse ? [inventory.warehouse] : [])])].map((name) => ({ value: name, label: name }))}
                placeholder={t("Склад")}
                allowClear={false}
                selectedLabel={warehouse}
                onChange={(value) => value !== warehouse && change(`${t("Вы уверены, что хотите сменить склад")}?`, () => setWarehouse(value))}
              />
            </FormField>
            {type === "custom_date" ? (
              <>
                <FormField label={t("Дата создания")} required>
                  <input
                    type="date"
                    value={invDate}
                    max={todayIso()}
                    onChange={(event) => {
                      const value = event.target.value
                      change(`${t("Вы уверены, что хотите сменить дату")}?`, () => setInvDate(value))
                    }}
                    className={inputClass}
                  />
                </FormField>
                <div>
                  <div className="text-[13px] text-[#586174]">{t("Время инвентаризации")}</div>
                  <Radio checked={!forDayEnd} label={t("На начало дня")} hint={t(START_HINT)} onChange={() => change(`${t("Вы уверены, что хотите сменить время")}?`, () => setForDayEnd(false))} />
                  <Radio checked={forDayEnd} label={t("На конец дня")} hint={t(END_HINT)} onChange={() => change(`${t("Вы уверены, что хотите сменить время")}?`, () => setForDayEnd(true))} />
                </div>
              </>
            ) : (
              editing && (
                <FormField label={t("Дата создания")}>
                  <span className={`${inputClass} flex items-center bg-[#f2f5f8]`}>{date}</span>
                </FormField>
              )
            )}
            <FormField label={t("Комментарий")}>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={2000} className={`${inputClass} h-auto py-2`} />
            </FormField>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong className="text-[15px]">{t("Список товаров")}</strong>
              <div className="flex flex-wrap items-center gap-3">
                <Hint text={ready ? null : needsDateText}>
                  <button type="button" disabled={!ready || !balances.data} onClick={() => setPickerOpen(true)} className={linkButton}>
                    {t("добавить из списка")}
                  </button>
                </Hint>
                <Hint text={ready ? null : needsDateText}>
                  <button type="button" disabled={!ready} onClick={() => setPanel(panel === "add" ? "none" : "add")} className={`${colorButton} bg-[rgb(79,113,220)]`}>
                    <Plus className="h-4 w-4" /> {t("Добавить товар")}
                  </button>
                </Hint>
                {!editing && (
                  <Hint text={ready ? null : needsDateText}>
                    <button type="button" disabled={!ready} onClick={() => setPanel(panel === "excel" ? "none" : "excel")} className={`${colorButton} bg-[#71ce87]`}>
                      <FileSpreadsheet className="h-4 w-4" /> {t("Импортировать c Excel")}
                    </button>
                  </Hint>
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
              <div className="mt-3 flex flex-wrap items-end gap-3 bg-[#f1f5f8] p-3">
                <FormField label={t("Наименование")} className="min-w-[220px] flex-[3]">
                  <SearchSelect
                    value={addKey}
                    loading={balances.loading}
                    options={balanceRows.map((row) => ({ value: row.key, label: `${row.name} (${formatQty(row.qty, row.unit)})`, hint: row.article || undefined }))}
                    placeholder={t("Наименование")}
                    onChange={(value) => setAddKey(value)}
                  />
                </FormField>
                <FormField label={t("Факт. остаток")} className="w-[160px]">
                  <span className="flex items-center gap-2">
                    <input
                      value={addAmount}
                      inputMode="decimal"
                      onChange={(event) => setAddAmount(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          applyAddRow()
                        }
                      }}
                      className={inputClass}
                    />
                    <span className="text-[#17233b]">{balanceMap.get(addKey)?.unit}</span>
                  </span>
                </FormField>
                <button
                  type="button"
                  disabled={!addKey || !validAmount(addAmount)}
                  onClick={applyAddRow}
                  title={t("Применить")}
                  aria-label={t("Применить")}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-[rgb(79,113,220)] hover:bg-white disabled:text-[#9aa3b6]"
                >
                  <Check className="h-5 w-5" />
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
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 py-16 text-center text-[#adadad]">
                <span>{t("Вы еще не выбрали ни одного товара")}.</span>
                {ready ? (
                  <button type="button" onClick={() => setPanel("add")} className="text-[rgb(79,113,220)] hover:underline">
                    {t("Добавить")} {t("товар")}?
                  </button>
                ) : (
                  <span>{needsDateText}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </CashModal>

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
