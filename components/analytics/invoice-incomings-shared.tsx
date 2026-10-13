"use client"

import { useMemo } from "react"

import { formatCash, useJsonList, type PickOption } from "@/components/analytics/cash-management-shared"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { INVOICE_STATUS_LABELS, parseVatRate, type InvoiceMatchKind, type InvoiceStatus } from "@/lib/invoice-incomings-types"

// Shared pieces of "Входящие счет фактуры" (view, form, dialogs): status badge,
// money / date formatting, catalog (products + raw materials) and party lookups.

export function formatInvoiceMoney(value: number, currency: string): string {
  return formatCash(value, currency)
}

export function formatInvoiceDate(iso: string): string {
  return iso ? formatDotDate(iso) : ""
}

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  pending: "bg-[#fff4e0] text-[#c77700]",
  accepted: "bg-[#e7f6ec] text-[#2e9b52]",
  rejected: "bg-[#fdecec] text-[#d64545]",
}

export function InvoiceStatusBadge({ status, title }: { status: InvoiceStatus; title?: string }) {
  const { t } = useLanguage()
  return (
    <span title={title} className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_STYLES[status]}`}>
      {t(INVOICE_STATUS_LABELS[status])}
    </span>
  )
}

/** Supplier incomings page opened on the create dialog prefilled from the invoice. */
export function supplyFromInvoiceHref(invoiceId: number): string {
  return `/analytics/supplier-incomings?openCreateDialog=true&invoiceId=${invoiceId}`
}

export type CatalogOption = { key: string; kind: InvoiceMatchKind; id: number; name: string; ikpu: string; unit: string; vatRate: number | null }

export const catalogKey = (kind: InvoiceMatchKind, id: number) => `${kind}:${id}`

type CatalogApiRow = { id: number; name: string; ikpu?: string; unit?: string; vat?: string; deleted?: boolean }

/** Products + raw materials (lines are matched with either); url = null skips. */
export function useInvoiceCatalog(enabled: boolean): { options: CatalogOption[]; loading: boolean } {
  const products = useJsonList<CatalogApiRow>(enabled ? "/api/products" : null)
  const raw = useJsonList<CatalogApiRow>(enabled ? "/api/raw-materials" : null)
  const options = useMemo(() => {
    const map = (kind: InvoiceMatchKind) => (row: CatalogApiRow): CatalogOption => ({
      key: catalogKey(kind, row.id),
      kind,
      id: row.id,
      name: row.name,
      ikpu: (row.ikpu ?? "").trim(),
      unit: row.unit ?? "",
      vatRate: parseVatRate(row.vat ?? "") ?? null,
    })
    return [...products.items.filter((row) => !row.deleted).map(map("product")), ...raw.items.map(map("raw_material"))]
  }, [products.items, raw.items])
  return { options, loading: products.loading || raw.loading }
}

/** Our suppliers / organizations as select options (value = id). */
export function useInvoiceParties(enabled = true): { suppliers: PickOption[]; organizations: PickOption[] } {
  const suppliers = useJsonList<{ id: number; name: string }>(enabled ? "/api/suppliers" : null)
  const organizations = useJsonList<{ id: number; name: string }>(enabled ? "/api/organizations" : null)
  return useMemo(
    () => ({
      suppliers: suppliers.items.map((item) => ({ value: String(item.id), label: item.name })).sort((a, b) => a.label.localeCompare(b.label, "ru")),
      organizations: organizations.items.map((item) => ({ value: String(item.id), label: item.name })).sort((a, b) => a.label.localeCompare(b.label, "ru")),
    }),
    [suppliers.items, organizations.items],
  )
}

/** Native select of the catalog (not clipped inside scrolling tables); value = catalogKey or "". */
export function CatalogSelect({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  invalid,
}: {
  value: string
  onChange: (option: CatalogOption | null) => void
  options: CatalogOption[]
  placeholder: string
  className?: string
  invalid?: boolean
}) {
  const { t } = useLanguage()
  const products = options.filter((option) => option.kind === "product")
  const raw = options.filter((option) => option.kind === "raw_material")
  return (
    <select
      value={value}
      onChange={(event) => onChange(options.find((option) => option.key === event.target.value) ?? null)}
      className={`h-9 w-full min-w-0 rounded-md border bg-white px-2 text-[13px] outline-none focus:border-[#4f70e7] ${invalid ? "border-[#e57373]" : "border-[#dbe0e8]"} ${className}`}
    >
      <option value="">{placeholder}</option>
      {products.length > 0 && (
        <optgroup label={t("Товары")}>
          {products.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </optgroup>
      )}
      {raw.length > 0 && (
        <optgroup label={t("Сырье")}>
          {raw.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/** Catalog item for a line: same ИКПУ first, then the same name (case-insensitive). */
export function autoMatch(options: CatalogOption[], name: string, ikpu: string): CatalogOption | null {
  const code = ikpu.trim()
  if (code) {
    const byCode = options.find((option) => option.ikpu === code)
    if (byCode) return byCode
  }
  const key = name.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ")
  if (!key) return null
  return options.find((option) => option.name.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ") === key) ?? null
}
