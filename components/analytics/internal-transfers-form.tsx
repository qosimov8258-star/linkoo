"use client"

import { useEffect, useMemo, useState } from "react"

import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { MaterialCheckbox } from "@/components/analytics/cash-material"
import { CashModal, ConfirmDialog, mutationError, parseAmount } from "@/components/analytics/cash-management-shared"
import { DateField, SelectField, Slot, TextField, isoToRuDate, ruDateToIso } from "@/components/analytics/supplier-incoming-form"
import { ExcelImportPanel, StockProductPicker, formatUnitTotals, validQty, type PickEntry } from "@/components/analytics/internal-transfers-picker"
import { TransferLinesEditor, boxesOf, lineFromItem, lineFromRow, type FormLine } from "@/components/analytics/internal-transfers-lines"
import { Spinner } from "@/components/analytics/internal-transfers-series"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockPickResult, Transfer, TransferOptions } from "@/lib/internal-transfers-types"

// Demo StockTransfersCreateDialog (c7 module 4346, lines 4643): "Добавить / Изменить передачу товаров",
// full screen. Left (30%) "Условия передачи товара": Со склада, На склад, Дата доставки, Дата создания,
// Прайс лист (×), Валюта (×), Организация (×), Номер накладной, Номер транспорта, Водитель, comment,
// "Подтвержденный" ("Сразу передать товары без потверждения" only with Linko's CAN_SEND_AUTO_ACCEPT, which this
// account does not set, so it is not shown). Right "Список товаров": "добавить из списка" (source balances),
// "Импортировать c Excel", the add row and the lines (internal-transfers-lines.tsx); footer Сумма / Общее кол-во
// (+ groups) and "Добавить" (the reference's label on edit too). Like the reference the form edits a transfer of any
// status; «Подтвержденный» only switches one that has not moved (the server keeps the status of one that moved). Line
// prices are typed with or without a price list and saved as typed. "Брак" on a line moves defective units (up to the
// defects on hand).

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
  // The reference names the currency next to the prices only once one is picked in the form.
  const [currencyPicked, setCurrencyPicked] = useState(false)
  const [organization, setOrganization] = useState(transfer?.organization ?? "")
  const [invoiceNumber, setInvoiceNumber] = useState(transfer?.invoiceNumber ?? "")
  const [transportNumber, setTransportNumber] = useState(transfer?.transportNumber ?? "")
  const [driver, setDriver] = useState(transfer?.driver ?? "")
  const [comment, setComment] = useState(transfer?.comment ?? "")
  // As the reference: ticked for a confirmed transfer (and a new one) only.
  const [confirmed, setConfirmed] = useState(transfer ? transfer.status === "потвержден" : true)
  const [lines, setLines] = useState<FormLine[]>(() => transfer?.items.map(lineFromItem) ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [askPrice, setAskPrice] = useState<string | null>(null)
  const [repriceTo, setRepriceTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const ready = Boolean(from && to)
  const includeKeys = useMemo(() => (transfer?.items ?? []).map((item) => item.key).filter(Boolean), [transfer])
  const products = useCashJson<StockPickResult>(from ? `/api/internal-transfers/products?${buildCashQuery({ warehouse: from, priceList, include: includeKeys })}` : null)
  const rows = useMemo(() => products.data?.rows ?? [], [products.data])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  const activeWarehouses = (options?.warehouses ?? []).filter((warehouse) => warehouse.active || warehouse.name === from || warehouse.name === to)
  const warehouseOptions = activeWarehouses.map((warehouse) => ({ value: warehouse.name, label: warehouse.name, hint: warehouse.address }))
  const shownCurrency = currency || (priceList && options?.priceListCurrency[priceList]) || options?.baseCurrency || "SUM"
  const priceCurrency = currencyPicked && currency ? currencyLabel(currency) : ""

  // After "Да" on a price-list change, the new list's prices replace the line prices once loaded.
  useEffect(() => {
    if (!repriceTo || products.loading || products.data?.priceList !== repriceTo) return
    setLines((current) => current.map((line) => ({ ...line, price: String(rowMap.get(line.key)?.price ?? line.price) })))
    setRepriceTo(null)
  }, [repriceTo, products.loading, products.data, rowMap])

  /** "добавить из списка" and the Excel import: a product already listed takes the new quantity. */
  const upsert = (entries: PickEntry[]) => {
    setLines((current) => {
      const next = [...current]
      const added: FormLine[] = []
      for (const { row, quantity, price } of entries) {
        const index = next.findIndex((line) => line.key === row.key)
        if (index >= 0) next[index] = { ...next[index], quantity, price: price || next[index].price }
        else added.push(lineFromRow(row, quantity, price || String(row.price || "")))
      }
      return [...added, ...next]
    })
    setError("")
  }

  /** Unit price of a line: as typed (a price list fills it in; Linko's custom_price). */
  const priceOf = (line: FormLine) => parseAmount(line.price)
  const amount = lines.reduce((sum, line) => sum + parseAmount(line.quantity) * priceOf(line), 0)
  // Quantities are totalled per unit (never "ед" over kg and pieces; «0 ед» with no lines, as the reference), then the
  // boxes, unrounded, in the app's decimals ("(83,33333 групп)").
  const totalQty = lines.length ? formatUnitTotals(lines.map((line) => ({ qty: parseAmount(line.quantity), unit: line.unit })), t) : `0 ${t("ед")}`
  const totalBoxes = lines.reduce((sum, line) => sum + boxesOf(line), 0)
  // A transfer that has not moved has no stock effect yet, so the source's available quantity applies as is; one
  // that moved already took its own lines out (the server checks only what changed).
  const moved = editing && (transfer.status === "в пути" || transfer.status === "принят")
  const availableOf = (line: FormLine) => (line.defect ? rowMap.get(line.key)?.defectsAvailable : rowMap.get(line.key)?.available) ?? 0
  const over = (line: FormLine) => !moved && parseAmount(line.quantity) > availableOf(line) + 1e-9

  const submit = async () => {
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
      // The form's Валюта; a transfer without one keeps none (the reference sends it as it is), a price list or a new
      // transfer falls back to the shown one.
      currency: currency || (priceList || !editing ? shownCurrency : ""),
      organization,
      invoiceNumber,
      transportNumber,
      driver,
      comment,
      isConfirmed: confirmed,
      items: lines.map((line) => ({
        key: line.key || undefined,
        product: line.name,
        quantity: parseAmount(line.quantity),
        price: parseAmount(line.price),
        series: line.series,
        seriesId: line.seriesId,
        ...(line.seriesAuto ? { seriesAuto: true, ...(line.seriesPrev ? { seriesPrev: line.seriesPrev } : {}) } : {}),
        ...(line.defect ? { defect: true } : {}),
      })),
    }
    const result = editing ? await cashMutate<Transfer>("PUT", `/api/internal-transfers/${transfer.id}`, body) : await cashMutate<Transfer>("POST", "/api/internal-transfers", body)
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved(result.data, !editing)
  }

  const field = 10000
  return (
    <CashModal
      title={editing ? t("Изменить передачу товаров") : t("Добавить передачу товаров")}
      onClose={onClose}
      size="screen"
      footer={
        <>
          <ul className="flex flex-wrap items-center gap-x-[20px] gap-y-1 pl-[15px] text-[14px] text-black">
            <li>
              {t("Сумма")}: <b className="text-[16px] font-semibold text-[#129fdd]">{formatMoney(amount, 2)}{priceCurrency ? ` ${priceCurrency}` : ""}</b>
            </li>
            <li>
              {t("Общее кол-во:")}{" "}
              <b className="text-[16px] font-semibold text-[#129fdd]">
                {totalQty}
                {totalBoxes ? ` (${formatMoney(totalBoxes, 5)} ${t("групп")})` : ""}
              </b>
            </li>
          </ul>
          {error && <span className="ml-auto mr-4 text-[13px] text-[#f44336]">{error}</span>}
          <button type="button" disabled={busy} onClick={() => void submit()} className={`${error ? "" : "ml-auto "}mr-[15px] h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:opacity-60`}>
            {t("Добавить")}
          </button>
        </>
      }
    >
      <div className="relative flex min-h-0 flex-1">
        {busy && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-white">
            <Spinner size={45} />
          </div>
        )}
        <div className="w-[30%] shrink-0 overflow-y-auto overflow-x-hidden overscroll-contain border-r border-[#efefef]">
          {/* Absolute geometry of the reference's form (underline tops measured from the top of this column); the
              fields span the column less its 30px padding on each side. */}
          <div className="relative mr-[10px] h-[780px]">
            <span className="absolute left-[30px] top-[19px] text-[13px] font-semibold leading-[18px] text-[#333]">{t("Условия передачи товара")}</span>
            <SelectField menu top={94.2} left={30} width={field} label={t("Со склада")} required value={from} options={warehouseOptions} onChange={setFrom} onClear={() => setFrom("")} error={!from ? t("Склад не выбран") : undefined} />
            <SelectField menu top={155.2 + (from ? 0 : 13)} left={30} width={field} label={t("На склад")} required value={to} options={warehouseOptions.filter((option) => option.value !== from)} onChange={setTo} onClear={() => setTo("")} error={!to ? t("Склад не выбран") : undefined} />
            {(() => {
              // The reference shows the "Склад не выбран" lines (13px each) as soon as it opens; the fields below move with them.
              const e = (from ? 0 : 13) + (to ? 0 : 13)
              return (
                <>
                  <DateField primary top={201.2 + e} left={30} width={field} label={t("Дата доставки")} required value={deliveredAt ? isoToRuDate(deliveredAt) : ""} onChange={(value) => setDeliveredAt(ruDateToIso(value))} />
                  <DateField primary top={253.2 + e} left={30} width={field} label={t("Дата создания")} required value={createdAt ? isoToRuDate(createdAt.slice(0, 10)) : ""} onChange={(value) => setCreatedAt(`${ruDateToIso(value) || createdAt.slice(0, 10)}T${createdAt.slice(11) || "00:00"}`)} />
                  <SelectField
                    menu
                    top={320.2 + e}
                    left={30}
                    width={field}
                    label={t("Прайс лист")}
                    required
                    value={priceList}
                    options={(options?.priceLists ?? []).map((name) => ({ value: name, label: name }))}
                    onChange={(value) => {
                      if (lines.length && value) setAskPrice(value)
                      else setPriceList(value)
                    }}
                    onClear={() => setPriceList("")}
                  />
                  <SelectField
                    menu
                    top={382.2 + e}
                    left={30}
                    width={field}
                    label={t("Валюта")}
                    value={currency}
                    options={(options?.currencies ?? []).map((code) => ({ value: code, label: currencyLabel(code) }))}
                    onChange={(value) => {
                      setCurrency(value)
                      setCurrencyPicked(true)
                    }}
                    onClear={() => {
                      setCurrency("")
                      setCurrencyPicked(false)
                    }}
                  />
                  <SelectField menu top={444.2 + e} left={30} width={field} label={t("Организация")} value={organization} options={(options?.organizations ?? []).map((name) => ({ value: name, label: name }))} onChange={setOrganization} onClear={() => setOrganization("")} />
                  <TextField top={496.2 + e} left={30} width={field} label={t("Номер накладной")} value={invoiceNumber} onChange={setInvoiceNumber} />
                  <TextField top={548.2 + e} left={30} width={field} label={t("Номер транспорта")} value={transportNumber} onChange={setTransportNumber} />
                  <TextField top={600.2 + e} left={30} width={field} label={t("Водитель")} value={driver} onChange={setDriver} />
                  <CommentField top={661.2 + e} left={30} width={field} label={`${t("Оставить комментарий")}...`} value={comment} onChange={setComment} />
                  <div style={{ top: 680 + e + (commentRows(comment) - 1) * 18 }} className="absolute left-[30px] flex flex-col gap-3">
                    <MaterialCheckbox checked={confirmed} onChange={setConfirmed} label={t("Подтвержденный")} />
                  </div>
                </>
              )
            })()}
          </div>
        </div>

        <div className="flex min-h-0 w-[70%] min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-[30px] py-[10px]">
            <strong className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</strong>
            <div className="flex flex-wrap items-center" title={ready ? undefined : t("Выберите склад")}>
              {/* Black while disabled too, as the reference's flat button. */}
              <button type="button" disabled={!ready || !rows.length} onClick={() => setPickerOpen(true)} className="h-9 px-4 text-[13px] font-medium uppercase text-black hover:bg-black/[0.04] disabled:cursor-default disabled:hover:bg-transparent">
                {t("добавить из списка")}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => setExcelOpen((open) => !open)}
                className="ml-[15px] inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-default disabled:hover:brightness-100"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg> {t("Импортировать c Excel")}
              </button>
            </div>
          </div>
          {excelOpen && ready && (
            <div className="shrink-0 px-[30px]">
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
            </div>
          )}
          {notice && <p className="shrink-0 px-[30px] pb-2 text-[13px] text-[#3aa76d]">{notice}</p>}
          {products.error && <p className="shrink-0 px-[30px] pb-2 text-[13px] text-[#e57373]">{t(products.error)}</p>}
          <TransferLinesEditor ready={ready} rows={rows} rowMap={rowMap} lines={lines} onLines={setLines} currency={priceCurrency} priceOf={priceOf} over={over} />
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

/** Rows of the comment field: one per line of text, up to 6 (the reference's rows 1, rowsMax 6). */
const commentRows = (value: string) => Math.min(6, Math.max(1, value.split("\n").length))

/** «Оставить комментарий...»: the reference's multi-line field with the text in regular weight; the label floats
 * above a value like the other fields, extra rows grow the field downwards. */
function CommentField({ top, left, width, label, value, onChange }: { top: number; left: number; width: number; label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false)
  const floating = Boolean(value) || focused
  const rows = commentRows(value)
  const bottom = top + (rows - 1) * 18
  return (
    <Slot top={bottom} left={left} width={width}>
      <span
        style={{ top: floating ? top - 43 : top - 24 }}
        className={`pointer-events-none absolute left-0 whitespace-nowrap text-black ${floating ? "text-[9.75px] font-semibold leading-[12px]" : "text-[13px] font-semibold leading-[18px]"}`}
      >
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        aria-label={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        style={{ top: top - 26 }}
        className="pointer-events-auto absolute inset-x-0 resize-none overflow-hidden bg-transparent text-[13px] font-normal leading-[18px] text-black outline-none"
      />
      <span style={{ top: bottom }} className={`absolute inset-x-0 ${focused ? "h-[2px] bg-[rgb(79,113,220)]" : "h-px bg-[#e0e0e0]"}`} />
    </Slot>
  )
}
