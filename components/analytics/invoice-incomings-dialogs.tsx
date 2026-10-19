"use client"

import { useRef, useState, type ChangeEvent, type ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Pencil, RotateCcw, Trash2, Truck, XCircle } from "lucide-react"

import {
  CashModal,
  ConfirmDialog,
  ErrorBlock,
  LoadingBlock,
  PrimaryButton,
  SecondaryButton,
  formatCashDate,
  inputClass,
  mutationError,
} from "@/components/analytics/cash-management-shared"
import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { formatInvoiceDate, formatInvoiceMoney, InvoiceStatusBadge } from "@/components/analytics/invoice-incomings-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  vatRateLabel,
  type InvoiceDetail,
  type InvoiceImportResult,
  type InvoiceImportRow,
  type InvoiceStatusAction,
} from "@/lib/invoice-incomings-types"

// Dialogs of "Входящие счет фактуры": the invoice card (header, lines, actions),
// reject reason, delete confirmation and the Excel import (template → preview with
// line errors → import).

type Translate = (text: string) => string

// --- invoice card ---------------------------------------------------------------------------

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-[#e7eaf0] py-1.5 text-[14px]">
      <dt className="shrink-0 text-[#586174]">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-[#17233b]">{children || "—"}</dd>
    </div>
  )
}

export function downloadInvoiceExcel(invoice: InvoiceDetail, t: Translate) {
  downloadExcelTable(`${t("Счет-фактура")} ${invoice.number}`, [
    [t("№ счет-фактуры"), invoice.number, t("Дата счет-фактуры"), formatInvoiceDate(invoice.date)],
    [t("Поставщик"), invoice.supplierName, t("ИНН"), invoice.supplierInn],
    [t("Покупатель"), invoice.organizationName || invoice.buyerName, t("ИНН"), invoice.buyerInn],
    [t("№ договора"), invoice.contractNumber, t("Дата договора"), formatInvoiceDate(invoice.contractDate)],
    [],
    [t("№"), t("Наименование"), t("ИКПУ"), t("Ед. изм."), t("Количество"), t("Цена"), t("Сумма"), t("Ставка НДС"), t("Сумма НДС"), t("Всего"), t("Товар в каталоге")],
    ...invoice.lines.map((line) => [
      line.position,
      line.name,
      line.ikpu,
      line.unit,
      line.quantity,
      line.price,
      line.amount,
      t(vatRateLabel(line.vatRate)),
      line.vatAmount,
      line.total,
      line.match?.name ?? "",
    ]),
    ["", t("Итого"), "", "", "", "", invoice.amountWithoutVat, "", invoice.vatAmount, invoice.total, invoice.currency],
  ])
}

export function InvoiceViewDialog({
  id,
  canEdit,
  version,
  onClose,
  onEdit,
  onChanged,
  onCreateSupply,
  notify,
}: {
  id: number
  canEdit: boolean
  /** Bumped by the page after an edit to refetch. */
  version: number
  onClose: () => void
  onEdit: (invoice: InvoiceDetail) => void
  onChanged: () => void
  onCreateSupply: (invoice: InvoiceDetail) => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<InvoiceDetail>(`/api/invoice-incomings/${id}?v=${version}`)
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState("")
  const invoice = detail.data

  const act = async (action: InvoiceStatusAction, reason = "") => {
    setBusy(true)
    setError("")
    const result = await cashMutate<InvoiceDetail>("PATCH", `/api/invoice-incomings/${id}`, { action, reason })
    setBusy(false)
    if (!result.ok) {
      setError(mutationError(result, t))
      return false
    }
    notify(action === "accept" ? "Счет-фактура принята" : action === "reject" ? "Счет-фактура отклонена" : "Счет-фактура возвращена в ожидание")
    detail.reload()
    onChanged()
    return true
  }

  const remove = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("DELETE", `/api/invoice-incomings/${id}`)
    setBusy(false)
    if (!result.ok) {
      setError(mutationError(result, t))
      return
    }
    setDeleteOpen(false)
    notify("Счет-фактура удалена")
    onChanged()
    onClose()
  }

  const footer = invoice && (
    <>
      {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
      <SecondaryButton onClick={() => downloadInvoiceExcel(invoice, t)}>
        <Download className="h-4 w-4" /> {t("Скачать")}
      </SecondaryButton>
      {canEdit && !invoice.incoming && (
        <SecondaryButton onClick={() => setDeleteOpen(true)} disabled={busy}>
          <Trash2 className="h-4 w-4" /> {t("Удалить")}
        </SecondaryButton>
      )}
      {canEdit && invoice.status !== "pending" && !invoice.incoming && (
        <SecondaryButton onClick={() => void act("reset")} disabled={busy}>
          <RotateCcw className="h-4 w-4" /> {t("Вернуть в ожидание")}
        </SecondaryButton>
      )}
      {canEdit && invoice.status === "pending" && (
        <>
          <SecondaryButton onClick={() => onEdit(invoice)} disabled={busy}>
            <Pencil className="h-4 w-4" /> {t("Изменить")}
          </SecondaryButton>
          <PrimaryButton tone="red" disabled={busy} onClick={() => setRejectOpen(true)}>
            <XCircle className="h-4 w-4" /> {t("Отклонить")}
          </PrimaryButton>
          <PrimaryButton tone="green" busy={busy} onClick={() => void act("accept")}>
            <CheckCircle2 className="h-4 w-4" /> {t("Принять")}
          </PrimaryButton>
        </>
      )}
      {canEdit && invoice.status === "accepted" && !invoice.incoming && (
        <PrimaryButton tone="green" onClick={() => onCreateSupply(invoice)}>
          <Truck className="h-4 w-4" /> {t("Создать приход")}
        </PrimaryButton>
      )}
    </>
  )

  return (
    <CashModal
      title={invoice ? `${t("Счет-фактура")} № ${invoice.number}` : t("Счет-фактура")}
      onClose={onClose}
      size="xl"
      headerExtra={invoice && <InvoiceStatusBadge status={invoice.status} />}
      footer={footer}
    >
      {detail.loading && !invoice && <LoadingBlock />}
      {detail.error && !invoice && <ErrorBlock error={detail.error} onRetry={detail.reload} />}
      {invoice && (
        <div className="flex flex-col gap-5">
          {invoice.status === "rejected" && (
            <div className="flex items-start gap-2 rounded-md bg-[#fdecec] px-4 py-3 text-[14px] text-[#b33a3a]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t("Причина отклонения")}: {invoice.rejectReason || "—"}
              </span>
            </div>
          )}
          {invoice.incoming && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#e7f6ec] px-4 py-3 text-[14px] text-[#2e7d4a]">
              <Truck className="h-4 w-4" />
              {t("По счет-фактуре создан")}
              <Link href="/analytics/supplier-incomings" className="font-semibold underline">
                {t("Приход №")} {invoice.incoming.id}
              </Link>
              <span className="text-[#586174]">({t(invoice.incoming.status)})</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-3">
            <dl>
              <p className="mb-1 text-[13px] font-bold uppercase text-[#586174]">{t("Документ")}</p>
              <Info label={t("Дата счет-фактуры")}>{formatInvoiceDate(invoice.date)}</Info>
              <Info label={t("Договор")}>
                {invoice.contractNumber ? `№ ${invoice.contractNumber}${invoice.contractDate ? ` ${t("от")} ${formatInvoiceDate(invoice.contractDate)}` : ""}` : ""}
              </Info>
              <Info label={t("Валюта")}>{invoice.currency}</Info>
              <Info label={t("Комментарий")}>{invoice.comment}</Info>
            </dl>
            <dl>
              <p className="mb-1 text-[13px] font-bold uppercase text-[#586174]">{t("Поставщик (продавец)")}</p>
              <Info label={t("Наименование")}>{invoice.supplierName}</Info>
              <Info label={t("ИНН")}>{invoice.supplierInn}</Info>
              <Info label={t("В справочнике")}>{invoice.supplierCatalogName || <span className="text-[#c77700]">{t("Не сопоставлен")}</span>}</Info>
            </dl>
            <dl>
              <p className="mb-1 text-[13px] font-bold uppercase text-[#586174]">{t("Покупатель")}</p>
              <Info label={t("Наименование")}>{invoice.buyerName}</Info>
              <Info label={t("ИНН")}>{invoice.buyerInn}</Info>
              <Info label={t("Организация")}>{invoice.organizationName || <span className="text-[#c77700]">{t("Не сопоставлена")}</span>}</Info>
            </dl>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                  <th className="px-2 py-2">№</th>
                  <th className="px-2 py-2">{t("Наименование")}</th>
                  <th className="px-2 py-2">{t("ИКПУ")}</th>
                  <th className="px-2 py-2">{t("Ед. изм.")}</th>
                  <th className="px-2 py-2 text-right">{t("Кол-во")}</th>
                  <th className="px-2 py-2 text-right">{t("Цена")}</th>
                  <th className="px-2 py-2 text-right">{t("Сумма")}</th>
                  <th className="px-2 py-2 text-right">{t("НДС")}</th>
                  <th className="px-2 py-2 text-right">{t("Сумма НДС")}</th>
                  <th className="px-2 py-2 text-right">{t("Всего")}</th>
                  <th className="px-2 py-2">{t("Товар в каталоге")}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id} className="border-b border-[#f0f2f5]">
                    <td className="px-2 py-2 text-[#9aa3b6]">{line.position}</td>
                    <td className="px-2 py-2">{line.name}</td>
                    <td className="px-2 py-2 font-mono text-[12px]">{line.ikpu || "—"}</td>
                    <td className="px-2 py-2">{line.unit}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{line.quantity.toLocaleString("ru-RU")}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{formatInvoiceMoney(line.price, invoice.currency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{formatInvoiceMoney(line.amount, invoice.currency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{t(vatRateLabel(line.vatRate))}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{formatInvoiceMoney(line.vatAmount, invoice.currency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{formatInvoiceMoney(line.total, invoice.currency)}</td>
                    <td className="px-2 py-2">{line.match ? line.match.name : <span className="text-[#c77700]">{t("Не сопоставлен")}</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={6} className="px-2 py-3 text-right">
                    {t("Итого")}:
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 text-right">{formatInvoiceMoney(invoice.amountWithoutVat, invoice.currency)}</td>
                  <td />
                  <td className="whitespace-nowrap px-2 py-3 text-right">{formatInvoiceMoney(invoice.vatAmount, invoice.currency)}</td>
                  <td className="whitespace-nowrap px-2 py-3 text-right">{formatInvoiceMoney(invoice.total, invoice.currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[12px] text-[#9aa3b6]">
            {t("Создал")}: {invoice.createdBy || "—"}
            {invoice.createdAt ? `, ${formatCashDate(invoice.createdAt, language)}` : ""}
            {invoice.statusChangedBy && (
              <>
                {" · "}
                {t(invoice.status === "accepted" ? "Принял" : "Отклонил")}: {invoice.statusChangedBy}
                {invoice.statusChangedAt ? `, ${formatCashDate(invoice.statusChangedAt, language)}` : ""}
              </>
            )}
          </p>
        </div>
      )}

      {rejectOpen && invoice && (
        <InvoiceRejectDialog
          busy={busy}
          error={error}
          onClose={() => setRejectOpen(false)}
          onConfirm={async (reason) => {
            if (await act("reject", reason)) setRejectOpen(false)
          }}
        />
      )}
      {deleteOpen && invoice && (
        <ConfirmDialog
          title={t("Удалить счет-фактуру")}
          text={`${t("Удалить счет-фактуру")} № ${invoice.number}?`}
          busy={busy}
          error={error}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => void remove()}
        />
      )}
    </CashModal>
  )
}

export function InvoiceRejectDialog({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useLanguage()
  const [reason, setReason] = useState("")
  return (
    <ConfirmDialog
      title={t("Отклонить счет-фактуру")}
      confirmLabel="Отклонить"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => {
        if (reason.trim()) onConfirm(reason)
      }}
    >
      <label className="flex flex-col gap-1 text-[13px] text-[#586174]">
        <span>
          {t("Причина отклонения")}
          <span className="text-[#e57373]"> *</span>
        </span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} autoFocus className={`${inputClass} h-auto py-2`} />
      </label>
    </ConfirmDialog>
  )
}

// --- Excel import ---------------------------------------------------------------------------

/** Template columns: [title, field]. Blank header cells repeat the invoice above. */
const TEMPLATE: Array<[string, keyof InvoiceImportRow]> = [
  ["№ счет-фактуры", "number"],
  ["Дата счет-фактуры", "date"],
  ["№ договора", "contractNumber"],
  ["Дата договора", "contractDate"],
  ["ИНН поставщика", "supplierInn"],
  ["Поставщик", "supplierName"],
  ["ИНН покупателя", "buyerInn"],
  ["Покупатель", "buyerName"],
  ["Валюта", "currency"],
  ["Комментарий", "comment"],
  ["Наименование товара", "name"],
  ["ИКПУ", "ikpu"],
  ["Ед. изм.", "unit"],
  ["Количество", "quantity"],
  ["Цена без НДС", "price"],
  ["Ставка НДС", "vatRate"],
]

const IMPORT_ALIASES: Record<string, keyof InvoiceImportRow> = {
  "номер счет фактуры": "number",
  "счет фактура": "number",
  "счет фактуры": "number",
  "номер документа": "number",
  "дата документа": "date",
  "номер договора": "contractNumber",
  "договор": "contractNumber",
  "инн продавца": "supplierInn",
  "продавец": "supplierName",
  "наименование": "name",
  "товар": "name",
  "товар услуга": "name",
  "мхик": "ikpu",
  "код икпу": "ikpu",
  "единица измерения": "unit",
  "ед изм": "unit",
  "кол во": "quantity",
  "цена": "price",
  "ставка ндс": "vatRate",
  "ндс ставка": "vatRate",
}

export function downloadInvoiceTemplate(t: Translate) {
  downloadExcelTable(t("Шаблон входящих счет-фактур"), [TEMPLATE.map(([title]) => t(title))])
}

function fieldLabel(field: string): string {
  return TEMPLATE.find(([, key]) => key === field)?.[0] ?? (field === "lines" ? "Товары и услуги" : field)
}

export function InvoiceImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (created: number) => void }) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Array<InvoiceImportRow & { row: number }>>([])
  const [preview, setPreview] = useState<InvoiceImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null
    event.target.value = ""
    setFile(picked)
    setPreview(null)
    setRows([])
    setError("")
    if (!picked) return
    setBusy(true)
    try {
      const sheet = await readExcelRows(picked)
      const aliases: Record<string, string> = { ...IMPORT_ALIASES }
      for (const [title, field] of TEMPLATE) {
        aliases[normalizeHeader(title)] = field
        aliases[normalizeHeader(t(title))] = field
      }
      const headerIndex = sheet.findIndex((row) => mapHeaderColumns(row, aliases).size >= 4)
      if (headerIndex < 0) {
        setError(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fields = mapHeaderColumns(sheet[headerIndex], aliases)
      const parsed = sheet
        .slice(headerIndex + 1)
        .map((cells, offset) => {
          const record: InvoiceImportRow & { row: number } = { row: headerIndex + offset + 2 }
          cells.forEach((value, index) => {
            const field = fields.get(index) as keyof InvoiceImportRow | undefined
            if (field && value && !record[field]) record[field] = value
          })
          return record
        })
        .filter((record) => Object.keys(record).length > 1)
      if (!parsed.length) {
        setError(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      setRows(parsed)
      const result = await cashMutate<InvoiceImportResult>("POST", "/api/invoice-incomings/import", { commit: false, rows: parsed })
      if (!result.ok) {
        setError(mutationError(result, t))
        return
      }
      setPreview(result.data)
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate<InvoiceImportResult>("POST", "/api/invoice-incomings/import", { commit: true, rows })
    setBusy(false)
    if (!result.ok) {
      setError(mutationError(result, t))
      return
    }
    if (!result.data.created.length) {
      // Something changed since the preview (e.g. a duplicate appeared): show the new errors.
      setPreview(result.data)
      return
    }
    onDone(result.data.created.length)
    onClose()
  }

  const invoices = preview?.invoices ?? []
  const canImport = Boolean(preview && invoices.length && !preview.errorsCount)

  return (
    <CashModal
      title={t("Импорт счет-фактур из Excel")}
      onClose={onClose}
      size="xl"
      zIndex={120}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          {preview && !error && (
            <span className={`mr-auto text-[13px] ${preview.errorsCount ? "text-[#e57373]" : "text-[#2e9b52]"}`}>
              {t("Счет-фактур")}: {invoices.length} · {t("Строк")}: {invoices.reduce((sum, invoice) => sum + invoice.lines.length, 0)} · {t("Ошибок")}: {preview.errorsCount}
            </span>
          )}
          <SecondaryButton onClick={onClose}>{t("Закрыть")}</SecondaryButton>
          <PrimaryButton tone="green" busy={busy} disabled={!canImport} onClick={() => void commit()}>
            {t("Импортировать")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => downloadInvoiceTemplate(t)} className="inline-flex items-center gap-2 font-semibold text-[#4f70e7] hover:underline">
            <Download className="h-4 w-4" /> {t("1. Скачать шаблон")}
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 font-semibold text-[#4f70e7] hover:underline">
            <FileSpreadsheet className="h-4 w-4" /> {file ? `${t("2. Загрузить файл")}: ${file.name}` : t("2. Загрузить файл")}
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void pick(event)} className="hidden" />
        </div>
        <p className="text-[13px] text-[#7b8497]">
          {t("Одна строка файла — одна строка товара. Пустые поля шапки (номер, дата, поставщик…) берутся из строки выше; новая счет-фактура начинается с нового номера или поставщика. Товары сопоставляются с каталогом по ИКПУ или наименованию.")}
        </p>

        {busy && !preview && <LoadingBlock className="py-8" />}
        {!file && !preview && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
          >
            <FileSpreadsheet className="h-8 w-8" />
            {t("Добавьте файл Excel или нажмите для выбора")}
          </button>
        )}

        {invoices.map((invoice) => (
          <div key={`${invoice.row}-${invoice.number}`} className={`rounded-md border ${invoice.errors.length || invoice.lines.some((line) => line.errors.length) ? "border-[#f3c1c1]" : "border-[#e1e5eb]"}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#eef1f5] bg-[#f7f9fc] px-4 py-2 text-[14px]">
              <b>
                {t("Счет-фактура")} № {invoice.number || "—"}
              </b>
              <span>{invoice.date ? formatInvoiceDate(invoice.date) : ""}</span>
              <span>
                {invoice.supplierName || "—"}
                {invoice.supplierInn ? ` (${t("ИНН")} ${invoice.supplierInn})` : ""}
              </span>
              <span className={invoice.supplierMatch ? "text-[#2e9b52]" : "text-[#c77700]"}>{invoice.supplierMatch ? `✓ ${invoice.supplierMatch.name}` : t("Поставщик не сопоставлен")}</span>
              <span className="ml-auto font-semibold">{formatInvoiceMoney(invoice.total, invoice.currency)}</span>
            </div>
            {invoice.errors.length > 0 && (
              <ul className="list-disc px-8 py-2 text-[13px] text-[#e57373]">
                {invoice.errors.map((item, index) => (
                  <li key={index}>
                    {t("Строка")} {item.row}, {t(fieldLabel(item.field))}: {t(item.error)}
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[#586174]">
                    <th className="px-3 py-1.5">{t("Строка")}</th>
                    <th className="px-3 py-1.5">{t("Наименование")}</th>
                    <th className="px-3 py-1.5">{t("ИКПУ")}</th>
                    <th className="px-3 py-1.5 text-right">{t("Кол-во")}</th>
                    <th className="px-3 py-1.5 text-right">{t("Цена")}</th>
                    <th className="px-3 py-1.5 text-right">{t("НДС")}</th>
                    <th className="px-3 py-1.5 text-right">{t("Всего")}</th>
                    <th className="px-3 py-1.5">{t("Товар в каталоге")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.row} className={`border-t border-[#f0f2f5] ${line.errors.length ? "bg-[#fff5f5]" : ""}`}>
                      <td className="px-3 py-1.5 text-[#9aa3b6]">{line.row}</td>
                      <td className="px-3 py-1.5">
                        {line.name || "—"}
                        {line.errors.map((item, index) => (
                          <span key={index} className="block text-[12px] text-[#e57373]">
                            {t(fieldLabel(item.field))}: {t(item.error)}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[12px]">{line.ikpu || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {line.quantity.toLocaleString("ru-RU")} {line.unit}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">{formatInvoiceMoney(line.price, invoice.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">{t(vatRateLabel(line.vatRate))}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">{formatInvoiceMoney(line.total, invoice.currency)}</td>
                      <td className="px-3 py-1.5">{line.match ? line.match.name : <span className="text-[#c77700]">{t("Не сопоставлен")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </CashModal>
  )
}
