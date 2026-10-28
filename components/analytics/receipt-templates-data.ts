// "Настройка чека" (demo #/receipt-setup/, API sales/check/template/): printed-check templates
// with text lines above ("Сверху") and below ("Снизу") the items.

export const RECEIPT_TEMPLATES_API = "/api/receipt-templates"

export const RECEIPT_POSITIONS: { id: ReceiptPosition; name: string }[] = [
  { id: "left", name: "Левый" },
  { id: "center", name: "Центр" },
  { id: "right", name: "Правый" },
]

export type ReceiptPosition = "left" | "center" | "right"
export type ReceiptLine = { name: string; isBold: boolean; position: ReceiptPosition | "" }
export type ReceiptTemplate = { id: number; name: string; printAutoCheck: boolean; headers: ReceiptLine[]; footers: ReceiptLine[] }
export type ReceiptTemplateListResult = { count: number; results: ReceiptTemplate[] }
export type ReceiptTemplatePayload = Omit<ReceiptTemplate, "id">

export const RECEIPT_ORDERINGS = ["name", "print_auto_check"] as const
