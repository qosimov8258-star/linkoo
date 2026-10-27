"use client"

import { useMemo, useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, FormField, PrimaryButton, SearchSelect, inputClass, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { StockProductPicker, validQty, type PickEntry } from "@/components/analytics/internal-transfers-picker"
import { formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { nowLocalIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickResult } from "@/lib/internal-transfers-types"
import type { WriteOff, WriteOffOptions } from "@/lib/write-offs-types"

// Demo WriteOffCreateDialog (c142 module 5198, products 5199): "Списание
// товара" — left "С какого склада", "Выберите дату", "Оставить комментарий";
// right "Список товаров" with "добавить товары" (the warehouse's available
// balance; disabled with "Выберите склад" until one is chosen) and an add row;
// footer "Общее кол-во" + "Списать". The cost is the cost of goods (server).
// "Брак" on a line writes off defective units (up to the defects on hand; no cost).

type Line = { key: string; name: string; unit: string; article: string; cost: number; quantity: string; series: string; defect: boolean }

export function WriteOffFormDialog({ options, onClose, onSaved }: { options: WriteOffOptions | null; onClose: () => void; onSaved: (writeOff: WriteOff) => void }) {
  const { t } = useLanguage()
  const [warehouse, setWarehouse] = useState("")
  const [date, setDate] = useState(nowLocalIso().slice(0, 16))
  const [comment, setComment] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addKey, setAddKey] = useState("")
  const [addQty, setAddQty] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const products = useCashJson<StockPickResult>(warehouse ? `/api/write-offs/products?${buildCashQuery({ warehouse, date: date.slice(0, 10) })}` : null)
  const rows = useMemo(() => products.data?.rows ?? [], [products.data])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])

  const upsert = (entries: PickEntry[]) => {
    setLines((current) => {
      const next = [...current]
      const added: Line[] = []
      for (const { row, quantity } of entries) {
        const index = next.findIndex((line) => line.key === row.key)
        if (index >= 0) next[index] = { ...next[index], quantity }
        else added.push({ key: row.key, name: row.name, unit: row.unit, article: row.article, cost: row.cost, quantity, series: "", defect: row.available <= 0 && row.defectsAvailable > 0 })
      }
      return [...added, ...next]
    })
    setError("")
  }
  const addRow = () => {
    const row = rowMap.get(addKey)
    if (!row || !validQty(addQty)) return
    upsert([{ row, quantity: addQty.trim(), price: "" }])
    setAddKey("")
    setAddQty("")
  }

  const availableOf = (line: Line) => (line.defect ? rowMap.get(line.key)?.defectsAvailable : rowMap.get(line.key)?.available) ?? 0
  const over = (line: Line) => parseAmount(line.quantity) > availableOf(line) + 1e-9
  const costOf = (line: Line) => (line.defect ? 0 : line.cost)
  const qtyTotal = lines.reduce((sum, line) => sum + parseAmount(line.quantity), 0)
  const sumTotal = lines.reduce((sum, line) => sum + parseAmount(line.quantity) * costOf(line), 0)
  // The total's unit only when every line shares it (never "ед" over kg and pieces).
  const lineUnits = new Set(lines.map((line) => line.unit.trim().toLowerCase()))
  const totalUnit = lineUnits.size === 1 && lines[0]?.unit.trim() ? t(lines[0].unit.trim()) : ""

  const submit = async () => {
    setShowErrors(true)
    setError("")
    if (!warehouse) return setError(t("Склад не выбран"))
    if (!lines.length) return setError(t("Добавьте товары"))
    if (lines.some((line) => !validQty(line.quantity))) return setError(t("Укажите количество"))
    setBusy(true)
    const result = await cashMutate<WriteOff>("POST", "/api/write-offs", {
      warehouse,
      date,
      comment,
      items: lines.map((line) => ({ key: line.key, product: line.name, qty: parseAmount(line.quantity), series: line.series.trim(), ...(line.defect ? { defect: true } : {}) })),
    })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved(result.data)
  }

  const field = "h-10 w-full rounded-md border border-[#dbe0e8] px-3 text-[14px] outline-none focus:border-[#4f70e7]"
  return (
    <CashModal
      title={t("Списание товара")}
      onClose={onClose}
      size="full"
      footer={
        <>
          <ul className="mr-auto flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-[#586174]">
            <li>
              {t("Общее кол-во")}: <b className="text-[#17233b]">{formatQty(qtyTotal, totalUnit)}</b>
            </li>
            <li>
              {t("Сумма")}: <b className="text-[#17233b]">{formatSum(sumTotal)}</b>
            </li>
          </ul>
          {error && <span className="w-full text-right text-[13px] text-[#e57373] md:w-auto">{error}</span>}
          <PrimaryButton tone="red" busy={busy} onClick={() => void submit()}>
            {t("Списать")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-col gap-3 lg:w-[320px] lg:shrink-0">
          <FormField label={t("С какого склада")} required error={showErrors && !warehouse ? t("Склад не выбран") : undefined}>
            <SearchSelect
              value={warehouse}
              options={(options?.warehouses ?? []).map((name) => ({ value: name, label: name }))}
              invalid={showErrors && !warehouse}
              onChange={(value) => {
                setWarehouse(value)
                setLines([])
              }}
            />
          </FormField>
          <FormField label={t("Выберите дату")} required>
            <input type="datetime-local" value={date} max={nowLocalIso().slice(0, 16)} onChange={(event) => setDate(event.target.value)} className={field} />
          </FormField>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={2000} placeholder={`${t("Оставить комментарий")}...`} className={`${inputClass} h-auto py-2`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong>{t("Список товаров")}</strong>
            <span title={warehouse ? undefined : t("Выберите склад")}>
              <button type="button" disabled={!warehouse || !rows.length} onClick={() => setPickerOpen(true)} className="text-[13px] font-semibold uppercase text-[rgb(79,113,220)] disabled:opacity-40">
                {t("добавить товары")}
              </button>
            </span>
          </div>
          {products.error && <p className="mt-2 text-[13px] text-[#e57373]">{t(products.error)}</p>}
          {warehouse && (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
              <FormField label={t("Наименование")}>
                <SearchSelect
                  value={addKey}
                  loading={products.loading}
                  options={rows
                    .filter((row) => row.available > 0 || row.defectsAvailable > 0)
                    .map((row) => ({
                      value: row.key,
                      label: `${row.name} (${formatQty(Math.max(0, row.available), row.unit)}${row.defectsAvailable > 0 ? `; ${t("Брак")}: ${formatQty(row.defectsAvailable, row.unit)}` : ""})`,
                      hint: row.article,
                    }))}
                  onChange={(value) => setAddKey(value)}
                />
              </FormField>
              <FormField label={t("Кол-во")}>
                <input value={addQty} inputMode="decimal" onChange={(event) => setAddQty(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addRow()} className={field} />
              </FormField>
              <button type="button" onClick={addRow} disabled={!addKey || !validQty(addQty)} aria-label={t("Добавить")} className="flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(79,113,220)] text-white disabled:opacity-40">
                <Plus className="h-5 w-5" />
              </button>
            </div>
          )}
          {lines.length ? (
            <div className="mt-3 max-h-[52vh] overflow-auto">
              <table className="w-full min-w-[600px] border-collapse text-[14px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-[#e1e5eb] text-left font-semibold">
                    <th className="py-2 pr-3">{t("Наименование")}</th>
                    <th className="py-2 pr-3">{t("Код товара")}</th>
                    <th className="py-2 pr-3">{t("Серия")}</th>
                    <th className="py-2 pr-3">{t("Кол-во")}</th>
                    <th className="py-2 pr-3 text-right">{t("Себестоимость")}</th>
                    <th className="py-2 pr-3 text-right">{t("Сумма")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const bad = !validQty(line.quantity) || over(line)
                    const row = rowMap.get(line.key)
                    return (
                      <tr key={line.key} className="border-b border-dashed border-[#e1e5eb]">
                        <td className="py-2 pr-3">
                          {line.name}
                          <span className={`block text-[12px] ${over(line) ? "text-[#e57373]" : "text-[#9aa3b6]"}`}>
                            {line.defect ? t("Брак") : t("Доступно")}: {formatQty(Math.max(0, availableOf(line)), line.unit)}
                          </span>
                          {(line.defect || (row?.defectsAvailable ?? 0) > 0) && (
                            <label className="mt-1 flex items-center gap-1.5 text-[12px] text-[#586174]">
                              <input
                                type="checkbox"
                                checked={line.defect}
                                onChange={(event) => setLines((current) => current.map((item, i) => (i === index ? { ...item, defect: event.target.checked } : item)))}
                                className="h-3.5 w-3.5 accent-[rgb(79,113,220)]"
                              />
                              {t("Брак")}
                            </label>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-[#586174]">{line.article || "-"}</td>
                        <td className="py-2 pr-3">
                          <input
                            value={line.series}
                            maxLength={200}
                            aria-label={`${t("Серия")}: ${line.name}`}
                            onChange={(event) => setLines((current) => current.map((item, i) => (i === index ? { ...item, series: event.target.value } : item)))}
                            className="h-9 w-[100px] border-b border-[#5d6474] bg-transparent px-1 outline-none"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-1.5">
                            <input
                              value={line.quantity}
                              inputMode="decimal"
                              aria-label={`${t("Кол-во")}: ${line.name}`}
                              onChange={(event) => setLines((current) => current.map((item, i) => (i === index ? { ...item, quantity: event.target.value } : item)))}
                              className={`h-9 w-[90px] border-b bg-transparent px-1 outline-none ${bad ? "border-[#e57373] text-[#e57373]" : "border-[#5d6474]"}`}
                            />
                            <span className="text-[#586174]">{line.unit}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatSum(costOf(line))}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatSum(parseAmount(line.quantity) * costOf(line))}</td>
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
            <p className="py-16 text-center text-[13px] text-[#9aa3b6]">{warehouse ? t("Товаров нет") : t("Выберите склад")}</p>
          )}
        </div>
      </div>

      {pickerOpen && (
        <StockProductPicker
          rows={rows}
          warehouse={warehouse}
          mode="writeoff"
          currency=""
          initial={new Map(lines.map((line) => [line.key, { quantity: line.quantity, price: "" }]))}
          onClose={() => setPickerOpen(false)}
          onSubmit={(entries) => {
            upsert(entries)
            setPickerOpen(false)
          }}
        />
      )}
    </CashModal>
  )
}
