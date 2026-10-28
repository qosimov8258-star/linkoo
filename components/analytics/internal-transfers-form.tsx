"use client"

import { useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { MaterialCheckbox } from "@/components/analytics/cash-material"
import { CashModal, ConfirmDialog, inputClass, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { DateField, SelectField, TextField, isoToRuDate, ruDateToIso } from "@/components/analytics/supplier-incoming-form"
import { ExcelImportPanel, StockProductPicker, formatUnitTotals, validQty, type PickEntry } from "@/components/analytics/internal-transfers-picker"
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
  // The reference shows the "Склад не выбран" lines (13px each) as soon as it opens; the fields below move with them.
  const e1 = from ? 0 : 13
  const e = e1 + (to ? 0 : 13)
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
      return { amount: sum.amount + qty * priceOf(line), weight: sum.weight + qty * line.weight }
    },
    { amount: 0, weight: 0 },
  )
  // Quantities are totalled per unit (never "ед" over kg and pieces).
  const totalQty = formatUnitTotals(lines.map((line) => ({ qty: parseAmount(line.quantity), unit: line.unit })), t)
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

  const field = inputClass
  return (
    <CashModal
      title={editing ? t("Изменить передачу товаров") : t("Добавить передачу товаров")}
      onClose={onClose}
      size="screen"
      footer={
        <>
          <ul className="flex flex-wrap items-center gap-x-[25.9px] gap-y-1 pl-[15px] text-[14px] text-black">
            <li>
              {t("Сумма")}: <b className="text-[16px] font-semibold text-[#129fdd]">{lines.length ? formatSum(totals.amount, shownCurrency) : "0"}</b>
            </li>
            <li>
              {t("Общее кол-во:")} <b className="text-[16px] font-semibold text-[#129fdd]">{totalQty}</b>
            </li>
          </ul>
          {error && <span className="ml-auto mr-4 text-[13px] text-[#f44336]">{error}</span>}
          <button type="button" disabled={busy} onClick={() => void submit()} className={`${error ? "" : "ml-auto "}mr-[31px] h-9 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:opacity-60`}>
            {editing ? t("Сохранить") : t("Добавить")}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="w-[389px] shrink-0 overflow-y-auto border-r border-[#efefef]">
          {/* Absolute geometry of the reference's form: underline tops measured from the top of this column. */}
          <div className="relative h-[780px]">
            <span className="absolute left-[30px] top-[19px] text-[13px] font-semibold leading-[18px] text-[#333]">{t("Условия передачи товара")}</span>
            <SelectField menu top={94.2} left={30} width={328} label={t("Со склада")} required value={from} options={warehouseOptions} onChange={setFrom} onClear={() => setFrom("")} error={!from ? "Склад не выбран" : undefined} />
            <SelectField menu top={155.2 + e1} left={30} width={328} label={t("На склад")} required value={to} options={warehouseOptions.filter((option) => option.value !== from)} onChange={setTo} onClear={() => setTo("")} error={!to ? "Склад не выбран" : undefined} />
            <DateField primary top={201.2 + e} left={30} width={328} label={t("Дата доставки")} required value={deliveredAt ? isoToRuDate(deliveredAt) : ""} onChange={(value) => setDeliveredAt(ruDateToIso(value))} />
            <DateField primary top={253.2 + e} left={30} width={328} label={t("Дата создания")} required value={createdAt ? isoToRuDate(createdAt.slice(0, 10)) : ""} onChange={(value) => setCreatedAt(`${ruDateToIso(value) || createdAt.slice(0, 10)}T${createdAt.slice(11) || "00:00"}`)} />
            <SelectField
              menu
              top={320.2 + e}
              left={30}
              width={328}
              label={t("Прайс лист")}
              required
              value={priceList}
              options={(options?.priceLists ?? []).map((name) => ({ value: name, label: name }))}
              onChange={(value) => {
                if (lines.length && value) setAskPrice(value)
                else setPriceList(value)
              }}
            />
            <SelectField menu top={382.2 + e} left={30} width={328} label={t("Валюта")} value={currency} options={(options?.currencies ?? []).map((code) => ({ value: code, label: code }))} onChange={setCurrency} />
            <SelectField menu top={444.2 + e} left={30} width={328} label={t("Организация")} value={organization} options={(options?.organizations ?? []).map((name) => ({ value: name, label: name }))} onChange={setOrganization} />
            <TextField top={496.2 + e} left={30} width={328} label={t("Номер накладной")} value={invoiceNumber} onChange={setInvoiceNumber} />
            <TextField top={548.2 + e} left={30} width={328} label={t("Номер транспорта")} value={transportNumber} onChange={setTransportNumber} />
            <TextField top={600.2 + e} left={30} width={328} label={t("Водитель")} value={driver} onChange={setDriver} />
            <TextField top={661.2 + e} left={30} width={328} label={`${t("Оставить комментарий")}...`} value={comment} onChange={setComment} />
            <div style={{ top: 680 + e }} className="absolute left-[30px] flex flex-col gap-3">
              <MaterialCheckbox checked={confirmed} disabled={autoAccept} onChange={setConfirmed} label={t("Подтвержденный")} />
              {!editing && <MaterialCheckbox checked={autoAccept} onChange={setAutoAccept} label={t("Сразу передать товары без потверждения")} />}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-[30px] pt-[9.7px]">
          <div className="flex h-[34px] flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</span>
            <div className="flex flex-wrap items-center gap-[31px]" title={ready ? undefined : t("Выберите склад")}>
              <button type="button" disabled={!ready || !rows.length} onClick={() => setPickerOpen(true)} className="mr-[2px] text-[13px] font-medium uppercase text-black hover:underline">
                {t("добавить из списка")}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => setExcelOpen((open) => !open)}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg> {t("Импортировать c Excel")}
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
            <div className="relative -mx-[30px] mt-[13px] h-[72px] bg-[#f0f4f8]">
              <SelectField
                menu
                top={52}
                left={38}
                width={264}
                label={t("Наименование")}
                value={addKey}
                options={rows
                  .filter((row) => row.available > 0 || row.defectsAvailable > 0)
                  .map((row) => ({
                    value: row.key,
                    label: `${row.name} (${formatQty(Math.max(0, row.available), row.unit)}${row.defectsAvailable > 0 ? `; ${t("Брак")}: ${formatQty(row.defectsAvailable, row.unit)}` : ""})`,
                  }))}
                onChange={(value) => {
                  setAddKey(value)
                  setAddPrice(String(rowMap.get(value)?.price || ""))
                }}
                onClear={() => setAddKey("")}
              />
              <TextField top={52} left={320} width={180} label={t("Кол-во")} value={addQty} onChange={setAddQty} />
              <TextField top={52} left={532} width={109} label={atCost ? t("Себестоимость") : t("Цена")} value={atCost ? String(rowMap.get(addKey)?.cost ?? "") : addPrice} onChange={atCost ? () => {} : setAddPrice} />
              <button type="button" onClick={addRow} disabled={!addKey || !validQty(addQty)} aria-label={t("Добавить")} className="absolute left-[686px] top-[27px] flex h-6 w-6 items-center justify-center disabled:opacity-100">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]" aria-hidden><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
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
            <p className="py-16 text-center text-[13px] text-[#9aa3b6]"></p>
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
