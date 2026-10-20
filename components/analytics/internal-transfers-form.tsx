"use client"

import { useEffect, useMemo, useState } from "react"
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ConfirmDialog, FormField, PrimaryButton, SearchSelect, inputClass, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { ExcelImportPanel, StockProductPicker, validQty, type PickEntry } from "@/components/analytics/internal-transfers-picker"
import { formatQty, formatSum, formatWeight } from "@/components/analytics/internal-transfers-shared"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickResult, StockPickRow, Transfer, TransferOptions } from "@/lib/internal-transfers-types"

// Demo StockTransfersCreateDialog (c7 module 4336, products table 4633):
// "Добавить / Изменить передачу товаров". Left "Условия передачи товара": Со
// склада, На склад, Дата доставки, Дата создания, Прайс лист, Валюта,
// Организация, Номер накладной, Номер транспорта, Водитель, comment,
// "Подтвержденный", "Сразу передать товары без подтверждения". Right "Список
// товаров": "добавить из списка" (source balances), "Импортировать c Excel",
// an add row (Наименование (available) / Кол-во / Цена) and the lines; footer
// Сумма / Общее кол-во / Вес and "Добавить". Without a price list the lines are
// valued at the cost of goods (server; shown here, not editable). "Брак" on a
// line moves defective units (up to the defects on hand).

type Line = { key: string; name: string; unit: string; article: string; weight: number; quantity: string; price: string; defect: boolean }

const lineFromRow = (row: StockPickRow, quantity: string, price: string): Line => ({
  key: row.key,
  name: row.name,
  unit: row.unit,
  article: row.article,
  weight: row.weight,
  quantity,
  price,
  defect: row.available <= 0 && row.defectsAvailable > 0,
})

export function TransferFormDialog({
  transfer,
  options,
  onClose,
  onSaved,
}: {
  /** null = "Добавить передачу товаров". */
  transfer: Transfer | null
  options: TransferOptions | null
  onClose: () => void
  onSaved: (transfer: Transfer, created: boolean) => void
}) {
  const { t } = useLanguage()
  const editing = transfer !== null
  const [from, setFrom] = useState(transfer?.fromWarehouse ?? "")
  const [to, setTo] = useState(transfer?.toWarehouse ?? "")
  const [deliveredAt, setDeliveredAt] = useState(transfer?.deliveredAt || todayIso())
  const [createdAt, setCreatedAt] = useState((transfer?.createdAt || nowLocalIso()).slice(0, 16))
  const [priceList, setPriceList] = useState(transfer?.priceList ?? "")
  const [currency, setCurrency] = useState(transfer?.currency ?? "")
  const [organization, setOrganization] = useState(transfer?.organization ?? "")
  const [invoiceNumber, setInvoiceNumber] = useState(transfer?.invoiceNumber ?? "")
  const [transportNumber, setTransportNumber] = useState(transfer?.transportNumber ?? "")
  const [driver, setDriver] = useState(transfer?.driver ?? "")
  const [comment, setComment] = useState(transfer?.comment ?? "")
  const [confirmed, setConfirmed] = useState(transfer ? transfer.status === "потвержден" : true)
  const [autoAccept, setAutoAccept] = useState(false)
  const [lines, setLines] = useState<Line[]>(
    () =>
      transfer?.items.map((item) => ({
        key: item.key,
        name: item.product,
        unit: item.unit,
        article: item.article,
        weight: item.weight,
        quantity: String(item.quantity),
        price: String(item.price),
        defect: Boolean(item.defect),
      })) ?? [],
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [askPrice, setAskPrice] = useState<string | null>(null)
  const [repriceTo, setRepriceTo] = useState<string | null>(null)
  const [addKey, setAddKey] = useState("")
  const [addQty, setAddQty] = useState("")
  const [addPrice, setAddPrice] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const ready = Boolean(from && to)
  const includeKeys = useMemo(() => (transfer?.items ?? []).map((item) => item.key).filter(Boolean), [transfer])
  const products = useCashJson<StockPickResult>(from ? `/api/internal-transfers/products?${buildCashQuery({ warehouse: from, priceList, include: includeKeys })}` : null)
  const rows = useMemo(() => products.data?.rows ?? [], [products.data])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const activeWarehouses = (options?.warehouses ?? []).filter((warehouse) => warehouse.active || warehouse.name === from || warehouse.name === to)
  const warehouseOptions = activeWarehouses.map((warehouse) => ({ value: warehouse.name, label: warehouse.name, hint: warehouse.address }))
  const shownCurrency = currency || (priceList && options?.priceListCurrency[priceList]) || options?.baseCurrency || "SUM"

  // After "Да" on a price-list change, the new list's prices replace the line prices once loaded.
  useEffect(() => {
    if (!repriceTo || products.loading || products.data?.priceList !== repriceTo) return
    setLines((current) => current.map((line) => ({ ...line, price: String(rowMap.get(line.key)?.price ?? line.price) })))
    setRepriceTo(null)
  }, [repriceTo, products.loading, products.data, rowMap])

  const upsert = (entries: PickEntry[]) => {
    setLines((current) => {
      const next = [...current]
      const added: Line[] = []
      for (const { row, quantity, price } of entries) {
        const index = next.findIndex((line) => line.key === row.key)
        if (index >= 0) next[index] = { ...next[index], quantity, price: price || next[index].price }
        else added.push(lineFromRow(row, quantity, price || String(row.price || "")))
      }
      return [...added, ...next]
    })
    setError("")
  }

  const addRow = () => {
    const row = rowMap.get(addKey)
    if (!row || !validQty(addQty)) return
    upsert([{ row, quantity: addQty.trim(), price: addPrice.trim() || String(row.price || "") }])
    setAddKey("")
    setAddQty("")
    setAddPrice("")
  }

  const atCost = !priceList
  /** Unit price of a line: the price list's (editable), else the cost of goods (Брак: none). */
  const priceOf = (line: Line) => (atCost ? (line.defect ? 0 : (rowMap.get(line.key)?.cost ?? parseAmount(line.price))) : parseAmount(line.price))
  const totals = lines.reduce(
    (sum, line) => {
      const qty = parseAmount(line.quantity)
      return { amount: sum.amount + qty * priceOf(line), qty: sum.qty + qty, weight: sum.weight + qty * line.weight }
    },
    { amount: 0, qty: 0, weight: 0 },
  )
  // The total's unit only when every line shares it (never "ед" over kg and pieces).
  const lineUnits = new Set(lines.map((line) => line.unit.trim().toLowerCase()))
  const totalUnit = lineUnits.size === 1 && lines[0]?.unit.trim() ? t(lines[0].unit.trim()) : ""
  // Editable transfers have no stock effect yet, so the source's available quantity applies as is.
  const availableOf = (line: Line) => (line.defect ? rowMap.get(line.key)?.defectsAvailable : rowMap.get(line.key)?.available) ?? 0
  const over = (line: Line) => parseAmount(line.quantity) > availableOf(line) + 1e-9

  const submit = async () => {
    setShowErrors(true)
    setError("")
    if (!from || !to) return setError(t("Склад не выбран"))
    if (from.trim().toLowerCase() === to.trim().toLowerCase()) return setError(t("Склад отправитель и склад получатель должны отличаться"))
    if (!lines.length) return setError(t("Добавьте товары"))
    if (lines.some((line) => !validQty(line.quantity))) return setError(t("Укажите количество"))
    setBusy(true)
    const body = {
      fromWarehouse: from,
      toWarehouse: to,
      createdAt,
      deliveredAt,
      priceList,
      currency: shownCurrency,
      organization,
      invoiceNumber,
      transportNumber,
      driver,
      comment,
      isConfirmed: confirmed,
      autoAccept: !editing && autoAccept,
      items: lines.map((line) => ({
        key: line.key || undefined,
        product: line.name,
        quantity: parseAmount(line.quantity),
        price: atCost ? 0 : parseAmount(line.price),
        ...(line.defect ? { defect: true } : {}),
      })),
    }
    const result = editing ? await cashMutate<Transfer>("PUT", `/api/internal-transfers/${transfer.id}`, body) : await cashMutate<Transfer>("POST", "/api/internal-transfers", body)
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved(result.data, !editing)
  }

  const field = "h-10 w-full rounded-md border border-[#dbe0e8] px-3 text-[14px] outline-none focus:border-[#4f70e7]"
  return (
    <CashModal
      title={editing ? t("Изменить передачу товаров") : t("Добавить передачу товаров")}
      onClose={onClose}
      size="full"
      footer={
        <>
          <ul className="mr-auto flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-[#586174]">
            <li>
              {t("Сумма")}: <b className="text-[#17233b]">{formatSum(totals.amount, shownCurrency)}</b>
            </li>
            <li>
              {t("Общее кол-во:")} <b className="text-[#17233b]">{formatQty(totals.qty, totalUnit)}</b>
            </li>
            <li>
              {t("Вес")}: <b className="text-[#17233b]">{formatWeight(totals.weight, t("кг"))}</b>
            </li>
          </ul>
          {error && <span className="w-full text-right text-[13px] text-[#e57373] md:w-auto">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {editing ? t("Сохранить") : t("Добавить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-col gap-3 lg:w-[330px] lg:shrink-0">
          <span className="text-[13px] font-semibold uppercase text-[#586174]">{t("Условия передачи товара")}</span>
          <FormField label={t("Со склада")} required error={showErrors && !from ? t("Склад не выбран") : undefined}>
            <SearchSelect value={from} options={warehouseOptions} onChange={(value) => setFrom(value)} invalid={showErrors && !from} />
          </FormField>
          <FormField label={t("На склад")} required error={showErrors && !to ? t("Склад не выбран") : undefined}>
            <SearchSelect value={to} options={warehouseOptions.filter((option) => option.value !== from)} onChange={(value) => setTo(value)} invalid={showErrors && !to} />
          </FormField>
          <FormField label={t("Дата доставки")} required>
            <input type="date" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className={field} />
          </FormField>
          <FormField label={t("Дата создания")} required>
            <input type="datetime-local" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} className={field} />
          </FormField>
          <FormField label={t("Прайс лист")}>
            <SearchSelect
              value={priceList}
              options={(options?.priceLists ?? []).map((name) => ({ value: name, label: name, hint: options?.priceListCurrency[name] }))}
              onChange={(value) => {
                if (lines.length && value) setAskPrice(value)
                else setPriceList(value)
              }}
            />
          </FormField>
          <FormField label={t("Валюта")}>
            <SearchSelect value={currency} options={(options?.currencies ?? []).map((code) => ({ value: code, label: code }))} placeholder={shownCurrency} onChange={(value) => setCurrency(value)} />
          </FormField>
          <FormField label={t("Организация")}>
            <SearchSelect value={organization} options={(options?.organizations ?? []).map((name) => ({ value: name, label: name }))} onChange={(value) => setOrganization(value)} />
          </FormField>
          <FormField label={t("Номер накладной")}>
            <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} maxLength={200} className={field} />
          </FormField>
          <FormField label={t("Номер транспорта")}>
            <input value={transportNumber} onChange={(event) => setTransportNumber(event.target.value)} maxLength={200} className={field} />
          </FormField>
          <FormField label={t("Водитель")}>
            <input value={driver} onChange={(event) => setDriver(event.target.value)} maxLength={200} className={field} />
          </FormField>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={2000} placeholder={`${t("Оставить комментарий")}...`} className={`${inputClass} h-auto py-2`} />
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={confirmed} disabled={autoAccept} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4 accent-[rgb(79,113,220)]" />
            {t("Подтвержденный")}
          </label>
          {!editing && (
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={autoAccept} onChange={(event) => setAutoAccept(event.target.checked)} className="h-4 w-4 accent-[rgb(79,113,220)]" />
              {t("Сразу передать товары без подтверждения")}
            </label>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong>{t("Список товаров")}</strong>
            <div className="flex flex-wrap items-center gap-3" title={ready ? undefined : t("Выберите склад")}>
              <button type="button" disabled={!ready || !rows.length} onClick={() => setPickerOpen(true)} className="text-[13px] font-semibold uppercase text-[rgb(79,113,220)] disabled:opacity-40">
                {t("добавить из списка")}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => setExcelOpen((open) => !open)}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-4 w-4" /> {t("Импортировать c Excel")}
              </button>
            </div>
          </div>
          {excelOpen && ready && (
            <ExcelImportPanel
              rows={rows}
              mode="transfer"
              fileName={`${t("Передача")} ${from}`}
              onImported={(entries) => {
                upsert(entries)
                setNotice(t("Продукты успешно добавлены"))
              }}
              onError={(text) => setError(text)}
            />
          )}
          {notice && <p className="mt-2 text-[13px] text-[#3aa76d]">{notice}</p>}
          {products.error && <p className="mt-2 text-[13px] text-[#e57373]">{t(products.error)}</p>}

          {ready && (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_110px_120px_auto] items-end gap-2">
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
                  onChange={(value) => {
                    setAddKey(value)
                    setAddPrice(String(rowMap.get(value)?.price || ""))
                  }}
                />
              </FormField>
              <FormField label={t("Кол-во")}>
                <input value={addQty} inputMode="decimal" onChange={(event) => setAddQty(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addRow()} className={field} />
              </FormField>
              <FormField label={atCost ? t("Себестоимость") : t("Цена")}>
                <input
                  value={atCost ? String(rowMap.get(addKey)?.cost ?? "") : addPrice}
                  disabled={atCost}
                  inputMode="decimal"
                  onChange={(event) => setAddPrice(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addRow()}
                  className={`${field} disabled:bg-[#f2f5f8]`}
                />
              </FormField>
              <button type="button" onClick={addRow} disabled={!addKey || !validQty(addQty)} aria-label={t("Добавить")} className="flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(79,113,220)] text-white disabled:opacity-40">
                <Plus className="h-5 w-5" />
              </button>
            </div>
          )}

          {lines.length ? (
            <div className="mt-3 max-h-[52vh] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-[14px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-[#e1e5eb] text-left font-semibold">
                    <th className="py-2 pr-3">{t("Наименование")}</th>
                    <th className="py-2 pr-3">{t("Кол-во")}</th>
                    <th className="py-2 pr-3">{atCost ? t("Себестоимость") : t("Цена")}</th>
                    <th className="py-2 pr-3 text-right">{t("Сумма")}</th>
                    <th className="py-2 pr-3 text-right">{t("Вес")}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const row = rowMap.get(line.key)
                    const bad = !validQty(line.quantity) || over(line)
                    const qty = parseAmount(line.quantity)
                    const update = (patch: Partial<Line>) => setLines((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
                    return (
                      <tr key={`${line.key}-${index}`} className="border-b border-dashed border-[#e1e5eb]">
                        <td className="py-2 pr-3">
                          {line.name}
                          <span className={`block text-[12px] ${over(line) ? "text-[#e57373]" : "text-[#9aa3b6]"}`}>
                            {line.defect ? t("Брак") : t("Доступно")}: {formatQty(Math.max(0, availableOf(line)), line.unit)}
                          </span>
                          {(line.defect || (row?.defectsAvailable ?? 0) > 0) && (
                            <label className="mt-1 flex items-center gap-1.5 text-[12px] text-[#586174]">
                              <input type="checkbox" checked={line.defect} onChange={(event) => update({ defect: event.target.checked })} className="h-3.5 w-3.5 accent-[rgb(79,113,220)]" />
                              {t("Брак")}
                            </label>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-1.5">
                            <input value={line.quantity} inputMode="decimal" aria-label={`${t("Кол-во")}: ${line.name}`} onChange={(event) => update({ quantity: event.target.value })} className={`h-9 w-[90px] border-b bg-transparent px-1 outline-none ${bad ? "border-[#e57373] text-[#e57373]" : "border-[#5d6474]"}`} />
                            <span className="text-[#586174]">{line.unit}</span>
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          {atCost ? (
                            <span className="text-[#586174]">{formatSum(priceOf(line))}</span>
                          ) : (
                            <input value={line.price} inputMode="decimal" aria-label={`${t("Цена")}: ${line.name}`} onChange={(event) => update({ price: event.target.value })} className="h-9 w-[110px] border-b border-[#5d6474] bg-transparent px-1 outline-none" />
                          )}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatSum(qty * priceOf(line))}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatWeight(qty * line.weight, t("кг"))}</td>
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
            <p className="py-16 text-center text-[13px] text-[#9aa3b6]">{ready ? t("Товаров нет") : t("Выберите склад")}</p>
          )}
        </div>
      </div>

      {pickerOpen && (
        <StockProductPicker
          rows={rows}
          warehouse={from}
          mode="transfer"
          currency={shownCurrency}
          initial={new Map(lines.map((line) => [line.key, { quantity: line.quantity, price: line.price }]))}
          onClose={() => setPickerOpen(false)}
          onSubmit={(entries) => {
            upsert(entries)
            setPickerOpen(false)
          }}
        />
      )}
      {askPrice !== null && (
        <ConfirmDialog
          title={t("Прайс лист")}
          text={`${t("Цены товаров будут изменены на")} ${askPrice}`}
          confirmLabel="Да"
          tone="blue"
          onConfirm={() => {
            setPriceList(askPrice)
            setRepriceTo(askPrice)
            setAskPrice(null)
          }}
          onClose={() => setAskPrice(null)}
        />
      )}
    </CashModal>
  )
}
