// Shared (client + server) types and pure helpers of "Входящие счет фактуры"
// (incoming e-invoices / ЭСФ from suppliers, EDO-style; spec: scratchpad
// extra/spec-invoice-incomings.md). Server code: lib/invoice-incomings-repo.ts.

export type InvoiceStatus = "pending" | "accepted" | "rejected"
export type InvoiceTab = InvoiceStatus | "all"

/** EDO tabs: "Все", "Ожидает", "Принятые", "Отклоненные". */
export const INVOICE_TABS: InvoiceTab[] = ["all", "pending", "accepted", "rejected"]
export const INVOICE_TAB_LABELS: Record<InvoiceTab, string> = { all: "Все", pending: "Ожидает", accepted: "Принятые", rejected: "Отклоненные" }
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = { pending: "Ожидает", accepted: "Принят", rejected: "Отклонен" }

/** VAT rate choices (same as the product card): null = "Без НДС". */
export const INVOICE_VAT_RATES: Array<number | null> = [null, 0, 12, 15]

export type InvoiceMatchKind = "product" | "raw_material"

/** Catalog item a line is matched with (product or raw material). */
export type InvoiceMatch = { kind: InvoiceMatchKind; id: number; name: string }

export type InvoiceLine = {
  id: number
  position: number
  name: string
  /** ИКПУ (MXIK) catalog code, 17 digits. */
  ikpu: string
  unit: string
  quantity: number
  /** Price per unit without VAT. */
  price: number
  /** quantity × price (without VAT). */
  amount: number
  /** null = "Без НДС". */
  vatRate: number | null
  vatAmount: number
  /** amount + vatAmount. */
  total: number
  match: InvoiceMatch | null
}

export type InvoiceIncomingLink = { id: number; status: string }

export type InvoiceRow = {
  id: number
  number: string
  date: string
  contractNumber: string
  contractDate: string
  supplierId: number | null
  /** Supplier name as on the document. */
  supplierName: string
  supplierInn: string
  /** Name in our suppliers catalog when matched. */
  supplierCatalogName: string
  organizationId: number | null
  /** Buyer (our organization) as on the document. */
  buyerName: string
  buyerInn: string
  organizationName: string
  currency: string
  amountWithoutVat: number
  vatAmount: number
  total: number
  status: InvoiceStatus
  rejectReason: string
  statusChangedAt: string
  statusChangedBy: string
  comment: string
  createdBy: string
  createdAt: string
  linesCount: number
  /** Supplier incoming ("Приход от поставщика") created from the invoice. */
  incoming: InvoiceIncomingLink | null
}

export type InvoiceDetail = InvoiceRow & { lines: InvoiceLine[] }

export type InvoiceCurrencyTotal = { currency: string; count: number; amountWithoutVat: number; vatAmount: number; total: number }

export type InvoiceListResult = {
  results: InvoiceRow[]
  count: number
  page: number
  pageSize: number
  /** Totals of the filtered list (all pages) per currency. */
  totals: InvoiceCurrencyTotal[]
  /** Documents per tab with the current filters. */
  tabCounts: Record<InvoiceTab, number>
}

export type InvoiceListQuery = {
  tab: InvoiceTab
  search: string
  page: number
  /** 0 = all rows (Excel). */
  pageSize: number
  fromDate: string
  toDate: string
  supplierIds: number[]
  organizationIds: number[]
  currencies: string[]
}

export type InvoiceLineInput = {
  name: string
  ikpu: string
  unit: string
  quantity: number
  price: number
  vatRate: number | null
  match: { kind: InvoiceMatchKind; id: number } | null
}

export type InvoiceInput = {
  number: string
  date: string
  contractNumber: string
  contractDate: string
  supplierId: number | null
  supplierName: string
  supplierInn: string
  organizationId: number | null
  buyerName: string
  buyerInn: string
  currency: string
  comment: string
  lines: InvoiceLineInput[]
}

export type InvoiceStatusAction = "accept" | "reject" | "reset"

// --- Excel import -------------------------------------------------------------------------

/** One spreadsheet row (header fields may be blank = same invoice as the row above). */
export type InvoiceImportRow = {
  number?: string
  date?: string
  contractNumber?: string
  contractDate?: string
  supplierInn?: string
  supplierName?: string
  buyerInn?: string
  buyerName?: string
  currency?: string
  comment?: string
  name?: string
  ikpu?: string
  unit?: string
  quantity?: string
  price?: string
  vatRate?: string
}

export type InvoiceImportIssue = { row: number; field: string; error: string }

export type InvoiceImportPreviewLine = {
  row: number
  name: string
  ikpu: string
  unit: string
  quantity: number
  price: number
  amount: number
  vatRate: number | null
  vatAmount: number
  total: number
  match: InvoiceMatch | null
  errors: InvoiceImportIssue[]
}

export type InvoiceImportPreviewInvoice = {
  /** First spreadsheet row of the invoice (1-based, as in Excel). */
  row: number
  number: string
  date: string
  contractNumber: string
  contractDate: string
  supplierName: string
  supplierInn: string
  supplierMatch: { id: number; name: string } | null
  buyerName: string
  buyerInn: string
  organizationMatch: { id: number; name: string } | null
  currency: string
  comment: string
  amountWithoutVat: number
  vatAmount: number
  total: number
  lines: InvoiceImportPreviewLine[]
  /** Header errors (number, date, supplier, duplicates …). */
  errors: InvoiceImportIssue[]
}

export type InvoiceImportResult = {
  invoices: InvoiceImportPreviewInvoice[]
  errorsCount: number
  /** Ids of the created invoices (empty for a preview or when any error exists). */
  created: number[]
}

// --- Supply ("Создать приход") ---------------------------------------------------------------

export type InvoiceSupplyDraftLine = {
  position: number
  name: string
  ikpu: string
  unit: string
  quantity: number
  /** Unit price with VAT (line total / quantity): what is owed to the supplier. */
  cost: number
  /** Catalog name (incoming items reference products by name); "" = not matched. */
  product: string
}

/** Prefill of the supplier incoming create dialog (GET /api/invoice-incomings/[id]/supply-draft). */
export type InvoiceSupplyDraft = {
  invoiceId: number
  number: string
  date: string
  contractNumber: string
  supplier: string
  supplierMatched: boolean
  organization: string
  organizationMatched: boolean
  currency: string
  total: number
  lines: InvoiceSupplyDraftLine[]
}

// --- pure helpers ---------------------------------------------------------------------------

export function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Line amounts as the e-invoice computes them: amount = qty × price, VAT = amount × rate %. */
export function calcInvoiceLine(quantity: number, price: number, vatRate: number | null): { amount: number; vatAmount: number; total: number } {
  const amount = roundTo((Number(quantity) || 0) * (Number(price) || 0))
  const vatAmount = vatRate ? roundTo((amount * vatRate) / 100) : 0
  return { amount, vatAmount, total: roundTo(amount + vatAmount) }
}

export function sumInvoiceLines(lines: Array<{ amount: number; vatAmount: number; total: number }>): { amountWithoutVat: number; vatAmount: number; total: number } {
  return {
    amountWithoutVat: roundTo(lines.reduce((sum, line) => sum + line.amount, 0)),
    vatAmount: roundTo(lines.reduce((sum, line) => sum + line.vatAmount, 0)),
    total: roundTo(lines.reduce((sum, line) => sum + line.total, 0)),
  }
}

/** "12%" / "12" / 0.12 (a percent-formatted Excel cell) / "без ндс" / "" → 12 / 12 / 12 / null / null;
 * undefined when not a rate. */
export function parseVatRate(value: string | number | null | undefined): number | null | undefined {
  if (value === null || value === undefined) return null
  const text = String(value).trim().toLowerCase().replace(",", ".")
  if (!text || /^без\s*ндс$|^qqssiz$|^without\s*vat$|^-$/.test(text)) return null
  const percent = text.endsWith("%")
  let number = Number(text.replace(/%$/, "").trim())
  if (!Number.isFinite(number) || number < 0 || number > 100) return undefined
  if (!percent && number > 0 && number < 1) number = roundTo(number * 100, 4)
  return number
}

export function vatRateLabel(rate: number | null): string {
  return rate === null ? "Без НДС" : `${rate}%`
}

/** ИКПУ (MXIK) is 17 digits. */
export const IKPU_PATTERN = /^\d{17}$/
/** ИНН of a company is 9 digits, ПИНФЛ of a person 14. */
export const INN_PATTERN = /^(\d{9}|\d{14})$/
