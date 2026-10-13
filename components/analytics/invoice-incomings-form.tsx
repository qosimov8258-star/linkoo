"use client"

import { useMemo, useState } from "react"
import { Plus, Wand2, X } from "lucide-react"

import {
  CashModal,
  FormField,
  PrimaryButton,
  SearchSelect,
  SecondaryButton,
  inputClass,
  parseAmount,
  useCashRates,
} from "@/components/analytics/cash-management-shared"
import { cashMutate } from "@/components/analytics/cash/use-cash"
import {
  autoMatch,
  CatalogSelect,
  catalogKey,
  formatInvoiceMoney,
  useInvoiceCatalog,
  useInvoiceParties,
  type CatalogOption,
} from "@/components/analytics/invoice-incomings-shared"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  calcInvoiceLine,
  INVOICE_VAT_RATES,
  sumInvoiceLines,
  vatRateLabel,
  type InvoiceDetail,
  type InvoiceInput,
  type InvoiceMatchKind,
} from "@/lib/invoice-incomings-types"

// Create / edit dialog of an incoming e-invoice: header (номер и дата, договор,
// поставщик по документу + наш справочник, покупатель + организация, валюта) and
// the lines grid (наименование, ИКПУ, ед. изм., кол-во, цена → сумма, НДС %, сумма
// НДС, всего; сопоставление с товаром / сырьём). Totals recalc on every change.

type DraftLine = {
  key: number
  name: string
  ikpu: string
  unit: string
  quantity: string
  price: string
  /** "" = "Без НДС". */
  vatRate: string
  match: string
}

type Draft = Omit<InvoiceInput, "lines" | "supplierId" | "organizationId"> & { supplierId: string; organizationId: string }

let lineSeed = 0
const nextKey = () => ++lineSeed

function emptyLine(patch: Partial<DraftLine> = {}): DraftLine {
  return { key: nextKey(), name: "", ikpu: "", unit: "", quantity: "1", price: "", vatRate: "12", match: "", ...patch }
}

function initialDraft(invoice: InvoiceDetail | null): Draft {
  if (!invoice) {
    return {
      number: "",
      date: todayIso(),
      contractNumber: "",
      contractDate: "",
      supplierId: "",
      supplierName: "",
      supplierInn: "",
      organizationId: "",
      buyerName: "",
      buyerInn: "",
      currency: "SUM",
      comment: "",
    }
  }
  return {
    number: invoice.number,
    date: invoice.date,
    contractNumber: invoice.contractNumber,
    contractDate: invoice.contractDate,
    supplierId: invoice.supplierId ? String(invoice.supplierId) : "",
    supplierName: invoice.supplierName,
    supplierInn: invoice.supplierInn,
    organizationId: invoice.organizationId ? String(invoice.organizationId) : "",
    buyerName: invoice.buyerName,
    buyerInn: invoice.buyerInn,
    currency: invoice.currency,
    comment: invoice.comment,
  }
}

function initialLines(invoice: InvoiceDetail | null): DraftLine[] {
  if (!invoice?.lines.length) return [emptyLine()]
  return invoice.lines.map((line) =>
    emptyLine({
      name: line.name,
      ikpu: line.ikpu,
      unit: line.unit,
      quantity: String(line.quantity),
      price: String(line.price),
      vatRate: line.vatRate === null ? "" : String(line.vatRate),
      match: line.match ? catalogKey(line.match.kind, line.match.id) : "",
    }),
  )
}

const vatOf = (value: string) => (value === "" ? null : Number(value))

export function InvoiceFormDialog({ invoice, onClose, onSaved }: { invoice: InvoiceDetail | null; onClose: () => void; onSaved: (saved: InvoiceDetail) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Draft>(() => initialDraft(invoice))
  const [lines, setLines] = useState<DraftLine[]>(() => initialLines(invoice))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null)
  // Keys of the lines in the order they were sent (server errors name "lines.<index>.<field>").
  const [sentKeys, setSentKeys] = useState<number[]>([])
  const catalog = useInvoiceCatalog(true)
  const parties = useInvoiceParties()
  const { codes } = useCashRates()
  const currencyCodes = useMemo(() => [...new Set([...codes, "SUM", "USD", "EUR", draft.currency])], [codes, draft.currency])

  const computed = lines.map((line) => calcInvoiceLine(parseAmount(line.quantity), parseAmount(line.price), vatOf(line.vatRate)))
  const totals = sumInvoiceLines(computed)

  const patch = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }))
  const patchLine = (key: number, value: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...value } : line)))
  const fieldError = (field: string) => (error?.field === field ? t(error.text) : undefined)

  const pickMatch = (key: number, option: CatalogOption | null) => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line
        if (!option) return { ...line, match: "" }
        // An empty line takes the catalog item's name, ИКПУ, unit and VAT.
        return {
          ...line,
          match: option.key,
          name: line.name || option.name,
          ikpu: line.ikpu || option.ikpu,
          unit: line.unit || option.unit,
          vatRate: line.name ? line.vatRate : option.vatRate === null ? "" : String(option.vatRate),
        }
      }),
    )
  }

  const addFromCatalog = (option: CatalogOption | null) => {
    if (!option) return
    const line = emptyLine({ name: option.name, ikpu: option.ikpu, unit: option.unit, vatRate: option.vatRate === null ? "" : String(option.vatRate), match: option.key })
    setLines((current) => [...current.filter((item) => item.name.trim() || item.price.trim()), line])
  }

  const matchAll = () => {
    setLines((current) =>
      current.map((line) => {
        if (line.match) return line
        const option = autoMatch(catalog.options, line.name, line.ikpu)
        return option ? { ...line, match: option.key } : line
      }),
    )
  }

  const isFilled = (line: DraftLine) => Boolean(line.name.trim() || line.price.trim() || line.ikpu.trim())

  const save = async () => {
    setBusy(true)
    setError(null)
    setSentKeys(lines.filter(isFilled).map((line) => line.key))
    const body: InvoiceInput = {
      ...draft,
      supplierId: draft.supplierId ? Number(draft.supplierId) : null,
      organizationId: draft.organizationId ? Number(draft.organizationId) : null,
      lines: lines
        .filter(isFilled)
        .map((line) => {
          const [kind, id] = line.match.split(":")
          return {
            name: line.name,
            ikpu: line.ikpu.replace(/\s/g, ""),
            unit: line.unit,
            quantity: parseAmount(line.quantity),
            price: parseAmount(line.price),
            vatRate: vatOf(line.vatRate),
            match: line.match ? { kind: kind as InvoiceMatchKind, id: Number(id) } : null,
          }
        }),
    }
    const result = await cashMutate<InvoiceDetail>(invoice ? "PUT" : "POST", invoice ? `/api/invoice-incomings/${invoice.id}` : "/api/invoice-incomings", body)
    setBusy(false)
    if (result.ok) {
      onSaved(result.data)
      return
    }
    setError({ text: result.status === 403 ? "Недостаточно прав" : result.status === 0 ? "Сервер недоступен, попробуйте ещё раз" : result.error, field: result.field })
  }

  const lineError = (key: number, field: string) => error?.field === `lines.${sentKeys.indexOf(key)}.${field}`
  const cell = "h-9 w-full min-w-0 rounded-md border bg-white px-2 text-[13px] outline-none focus:border-[#4f70e7]"
  const border = (invalid: boolean) => (invalid ? "border-[#e57373]" : "border-[#dbe0e8]")
  const filledLines = lines.filter(isFilled)

  return (
    <CashModal
      title={invoice ? `${t("Изменить счет-фактуру")} № ${invoice.number}` : t("Новая входящая счет-фактура")}
      onClose={onClose}
      size="full"
      zIndex={110}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{t(error.text)}</span>}
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} disabled={!filledLines.length} onClick={() => void save()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <FormField label={t("№ счет-фактуры")} required error={fieldError("number")}>
            <input value={draft.number} onChange={(event) => patch({ number: event.target.value })} className={inputClass} autoFocus />
          </FormField>
          <FormField label={t("Дата счет-фактуры")} required error={fieldError("date")}>
            <input type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value })} className={inputClass} />
          </FormField>
          <FormField label={t("№ договора")}>
            <input value={draft.contractNumber} onChange={(event) => patch({ contractNumber: event.target.value })} className={inputClass} />
          </FormField>
          <FormField label={t("Дата договора")} error={fieldError("contractDate")}>
            <input type="date" value={draft.contractDate} onChange={(event) => patch({ contractDate: event.target.value })} className={inputClass} />
          </FormField>
          <FormField label={t("Валюта")} required error={fieldError("currency")}>
            <select value={draft.currency} onChange={(event) => patch({ currency: event.target.value })} className={inputClass}>
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-md bg-[#f7f9fc] p-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-bold uppercase text-[#586174]">{t("Поставщик (продавец)")}</p>
            <FormField label={t("Поставщик в справочнике")} error={fieldError("supplierId")}>
              <SearchSelect
                value={draft.supplierId}
                options={parties.suppliers}
                placeholder={t("Не сопоставлен")}
                onChange={(value, option) => patch({ supplierId: value, supplierName: draft.supplierName || option?.label || "" })}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <FormField label={t("Наименование по документу")} required error={fieldError("supplierName")}>
                <input value={draft.supplierName} onChange={(event) => patch({ supplierName: event.target.value })} className={inputClass} />
              </FormField>
              <FormField label={t("ИНН")} error={fieldError("supplierInn")}>
                <input value={draft.supplierInn} inputMode="numeric" maxLength={14} onChange={(event) => patch({ supplierInn: event.target.value.replace(/\D/g, "") })} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-bold uppercase text-[#586174]">{t("Покупатель")}</p>
            <FormField label={t("Организация")} error={fieldError("organizationId")}>
              <SearchSelect
                value={draft.organizationId}
                options={parties.organizations}
                placeholder={t("Не сопоставлена")}
                onChange={(value, option) => patch({ organizationId: value, buyerName: draft.buyerName || option?.label || "" })}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <FormField label={t("Наименование по документу")}>
                <input value={draft.buyerName} onChange={(event) => patch({ buyerName: event.target.value })} className={inputClass} />
              </FormField>
              <FormField label={t("ИНН")} error={fieldError("buyerInn")}>
                <input value={draft.buyerInn} inputMode="numeric" maxLength={14} onChange={(event) => patch({ buyerInn: event.target.value.replace(/\D/g, "") })} className={inputClass} />
              </FormField>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            <p className="mr-auto text-[15px] font-bold text-[#17233b]">{t("Товары и услуги")}</p>
            <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#4f70e7] hover:underline">
              <Plus className="h-4 w-4" /> {t("Добавить строку")}
            </button>
            <div className="w-[240px]">
              <CatalogSelect value="" options={catalog.options} placeholder={t("+ Добавить из каталога")} onChange={addFromCatalog} />
            </div>
            <button type="button" onClick={matchAll} disabled={!catalog.options.length} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#4f70e7] hover:underline disabled:opacity-40" title={t("Сопоставить строки с каталогом по ИКПУ или наименованию")}>
              <Wand2 className="h-4 w-4" /> {t("Сопоставить с каталогом")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1240px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                  <th className="w-8 px-1 py-2">№</th>
                  <th className="min-w-[200px] px-1 py-2">{t("Наименование")} *</th>
                  <th className="w-[150px] px-1 py-2">{t("ИКПУ")}</th>
                  <th className="w-[70px] px-1 py-2">{t("Ед. изм.")}</th>
                  <th className="w-[90px] px-1 py-2">{t("Кол-во")} *</th>
                  <th className="w-[110px] px-1 py-2">{t("Цена")} *</th>
                  <th className="w-[110px] px-1 py-2 text-right">{t("Сумма")}</th>
                  <th className="w-[100px] px-1 py-2">{t("НДС")}</th>
                  <th className="w-[100px] px-1 py-2 text-right">{t("Сумма НДС")}</th>
                  <th className="w-[120px] px-1 py-2 text-right">{t("Всего")}</th>
                  <th className="w-[190px] px-1 py-2">{t("Товар в каталоге")}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="border-b border-[#f0f2f5] align-top">
                    <td className="px-1 py-1.5 pt-3 text-[#9aa3b6]">{index + 1}</td>
                    <td className="px-1 py-1.5">
                      <input value={line.name} onChange={(event) => patchLine(line.key, { name: event.target.value })} className={`${cell} ${border(lineError(line.key, "name"))}`} />
                    </td>
                    <td className="px-1 py-1.5">
                      <input
                        value={line.ikpu}
                        inputMode="numeric"
                        maxLength={17}
                        placeholder="00000000000000000"
                        onChange={(event) => patchLine(line.key, { ikpu: event.target.value.replace(/\D/g, "") })}
                        className={`${cell} ${border(lineError(line.key, "ikpu"))}`}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <input value={line.unit} onChange={(event) => patchLine(line.key, { unit: event.target.value })} className={`${cell} ${border(false)}`} />
                    </td>
                    <td className="px-1 py-1.5">
                      <input value={line.quantity} inputMode="decimal" onChange={(event) => patchLine(line.key, { quantity: event.target.value })} className={`${cell} ${border(lineError(line.key, "quantity"))}`} />
                    </td>
                    <td className="px-1 py-1.5">
                      <input value={line.price} inputMode="decimal" onChange={(event) => patchLine(line.key, { price: event.target.value })} className={`${cell} ${border(lineError(line.key, "price"))}`} />
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 pt-3 text-right">{formatInvoiceMoney(computed[index].amount, draft.currency)}</td>
                    <td className="px-1 py-1.5">
                      <select value={line.vatRate} onChange={(event) => patchLine(line.key, { vatRate: event.target.value })} className={`${cell} ${border(lineError(line.key, "vatRate"))}`}>
                        {INVOICE_VAT_RATES.map((rate) => (
                          <option key={String(rate)} value={rate === null ? "" : String(rate)}>
                            {t(vatRateLabel(rate))}
                          </option>
                        ))}
                        {line.vatRate !== "" && !INVOICE_VAT_RATES.includes(Number(line.vatRate)) && <option value={line.vatRate}>{line.vatRate}%</option>}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 pt-3 text-right">{formatInvoiceMoney(computed[index].vatAmount, draft.currency)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 pt-3 text-right font-semibold">{formatInvoiceMoney(computed[index].total, draft.currency)}</td>
                    <td className="px-1 py-1.5">
                      <CatalogSelect value={line.match} options={catalog.options} placeholder={t("Не сопоставлен")} invalid={lineError(line.key, "match")} onChange={(option) => pickMatch(line.key, option)} />
                    </td>
                    <td className="px-1 py-1.5 pt-2.5">
                      <button
                        type="button"
                        onClick={() => setLines((current) => (current.length > 1 ? current.filter((item) => item.key !== line.key) : [emptyLine()]))}
                        aria-label={t("Удалить")}
                        className="text-[#9aa3b6] hover:text-[#e57373]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-[#17233b]">
                  <td colSpan={6} className="px-1 py-3 text-right">
                    {t("Итого")}:
                  </td>
                  <td className="whitespace-nowrap px-1 py-3 text-right">{formatInvoiceMoney(totals.amountWithoutVat, draft.currency)}</td>
                  <td />
                  <td className="whitespace-nowrap px-1 py-3 text-right">{formatInvoiceMoney(totals.vatAmount, draft.currency)}</td>
                  <td className="whitespace-nowrap px-1 py-3 text-right">{formatInvoiceMoney(totals.total, draft.currency)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <FormField label={t("Комментарий")}>
          <textarea value={draft.comment} onChange={(event) => patch({ comment: event.target.value })} rows={2} className={`${inputClass} h-auto py-2`} />
        </FormField>
      </div>
    </CashModal>
  )
}
