"use client"

import { useState, type CSSProperties, type ReactNode } from "react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, LoadingBlock, mutationError } from "@/components/analytics/cash-management-shared"
import { InventoryCommentDialog } from "@/components/analytics/stock-inventory-card-dialogs"
import { formatQty, formatSum, inventoryDateText, inventoryItemsSheet } from "@/components/analytics/stock-inventory-shared"
import { RefTip } from "@/components/ref/ref-tip"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { STOCK_INVENTORY_STATUS_LABELS, STOCK_INVENTORY_TYPE_LABELS, type StockInventoryDetail } from "@/lib/stock-inventories-types"

// Linko's InventoryDetail (chunk 0 module 4761), shown in place of the clicked row. Header (65px): the creator's name;
// ✎ «Изменить» (enabled while pending → ?openUpdateDialog=true), «Скачать Excel» (file and sheet «Товары»),
// «Подтвердить» while pending (?openVerifyDialog=true) or «Отменить» once confirmed (?inventoryCancelOpen=<id>), and
// 🗑 «Удалить» unless cancelled (?openCreateDialog=true, the key Linko's delete dialog reuses). Left (350px): Тип,
// Склад, Статус, Дата создания, Время, Комментарий. Right: Наименование | Серия | Баланс (до) | Баланс (после) |
// Разница | Сумма <currency> on Linko's 12-column grid (2/2/1/1/2/2) and «Итого:», with the values stored on the
// document (a pending one: those of its last save; a confirmed one: those of its confirmation).

/** URL keys of the card's dialogs (Linko's own names). */
export type InventoryDialogKey = "openUpdateDialog" | "openVerifyDialog" | "inventoryCancelOpen" | "openCreateDialog"
export const INVENTORY_DIALOG_KEYS: InventoryDialogKey[] = ["openUpdateDialog", "openVerifyDialog", "inventoryCancelOpen", "openCreateDialog"]

// Rows of Linko's lists: 15px top and bottom, parted by a dotted line (2px dots every 8px).
const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }
const GRID = "relative grid grid-cols-12 items-center py-[15px] leading-4"
// Bootstrap columns: 8px gutters, none at the outer edges; every cell but the first is right-aligned.
const CELL = "px-[8px] text-right"
const FIRST = "pr-[8px] text-left"
const LAST = "pl-[8px] text-right"

function Dots() {
  return <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Linko's row: «Label: <strong>value</strong>» spread by justify-content, with no gap of its own.
    <div className="mb-[10px] flex items-start justify-between leading-[16.5px]">
      <span>{label}:</span>
      <strong className="text-right font-semibold">{children}</strong>
    </div>
  )
}

// Linko's IconButton has no hover circle.
const ICON_BUTTON = "flex h-12 w-12 items-center justify-center text-[#666] disabled:cursor-default disabled:text-[#ccc]"
// The RefTip wrapper of an icon button: "group/tip" keeps the app-wide title hint (components/ref/title-tooltips.tsx)
// from drawing a second bubble for the button's aria-label.
const TIP = "group/tip"

/** Linko's exceljs sheet: each column 1.5 × its longest text. */
function sheetWidths(rows: Array<Array<string | number>>): number[] {
  const count = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return Array.from({ length: count }, (_, column) => Math.ceil(1.5 * Math.max(1, ...rows.map((row) => String(row[column] ?? "").length))))
}
// Linko's FlatButton keeps 8px on its right.
const FLAT_BUTTON = "mr-[8px] inline-flex h-[30px] items-center rounded-[2px] pl-[12px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60"

export function InventoryDetailPanel({
  id,
  canEdit,
  dialogs,
  onDialog,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
  notify,
}: {
  id: number
  canEdit: boolean
  /** The dialog keys of the URL (Linko keeps a closed one as "false"). */
  dialogs: Partial<Record<InventoryDialogKey, string>>
  onDialog: (key: InventoryDialogKey, value: string) => void
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
  onDeleted: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<StockInventoryDetail>(`/api/stock/inventories/${id}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  const run = async (kind: "confirm" | "cancel" | "delete", comment = "") => {
    setBusy(true)
    setError("")
    const result =
      kind === "confirm"
        ? await cashMutate("POST", `/api/stock/inventories/${id}/confirm`, { comment })
        : kind === "cancel"
          ? await cashMutate("PUT", `/api/stock/inventories/${id}/cancel`)
          : await cashMutate("DELETE", `/api/stock/inventories/${id}`, { comment })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onDialog(kind === "confirm" ? "openVerifyDialog" : kind === "cancel" ? "inventoryCancelOpen" : "openCreateDialog", "false")
    if (kind === "delete") {
      notify(t("Успешно удалено"))
      onDeleted()
      return
    }
    notify(t("Успешно сохранено"))
    detail.reload()
    onChanged()
  }

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const pending = data.status === "pending"
  const confirmed = data.status === "confirmed"
  const verifyOpen = canEdit && pending && dialogs.openVerifyDialog === "true"
  const cancelOpen = canEdit && confirmed && dialogs.inventoryCancelOpen === String(id)
  const deleteOpen = canEdit && data.status !== "canceled" && dialogs.openCreateDialog === "true"
  const closeDialog = (key: InventoryDialogKey) => {
    setError("")
    onDialog(key, "false")
  }
  return (
    <div className="text-[13px] text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 z-[1] cursor-pointer" aria-label={t("Закрыть")} />
        <span className="truncate text-[16px] font-bold leading-5">{data.createdBy}</span>
        <div className="relative z-[2] flex items-center gap-[10px]">
          {canEdit && (
            <RefTip text={t("Изменить")} side="bottom" className={TIP}>
              <button type="button" disabled={!pending} onClick={onEdit} aria-label={t("Изменить")} className={ICON_BUTTON}>
                {/* Material "Edit" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
            </RefTip>
          )}
          <button
            type="button"
            onClick={() => {
              const sheet = inventoryItemsSheet(data, t)
              downloadExcelTable(t("Товары"), sheet, { sheetName: t("Товары"), widths: sheetWidths(sheet) })
            }}
            className={`${FLAT_BUTTON} bg-[#71ce87]`}
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            <span className="pl-[8px] pr-[16px]">{t("Скачать Excel")}</span>
          </button>
          {canEdit && pending && (
            <button type="button" onClick={() => onDialog("openVerifyDialog", "true")} className={`${FLAT_BUTTON} bg-[rgb(79,113,220)]`}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span className="pl-[8px] pr-[16px]">{t("Подтвердить")}</span>
            </button>
          )}
          {canEdit && confirmed && (
            <button type="button" onClick={() => onDialog("inventoryCancelOpen", String(id))} className={`${FLAT_BUTTON} bg-[#fa8072]`}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" />
              </svg>
              <span className="pl-[8px] pr-[16px]">{t("Отменить")}</span>
            </button>
          )}
          {canEdit && data.status !== "canceled" && (
            <RefTip text={t("Удалить")} side="bottom" className={TIP}>
              <button type="button" onClick={() => onDialog("openCreateDialog", "true")} aria-label={t("Удалить")} className={ICON_BUTTON}>
                {/* Material "Delete" */}
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </button>
            </RefTip>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        {/* With no lines Linko's empty block is 100% wide in the same flex row, so this column (350px, its padding on the
            inner block as Linko's) shrinks in proportion to it. */}
        <div className={`${data.items.length ? "shrink-0" : ""} border-b border-[#efefef] md:w-[350px] md:border-b-0 md:border-r`}>
          <div className="px-[30px] py-[20px]">
            <InfoRow label={t("Тип")}>{t(STOCK_INVENTORY_TYPE_LABELS[data.type])}</InfoRow>
            <InfoRow label={t("Склад")}>{data.warehouse}</InfoRow>
            <InfoRow label={t("Статус")}>{t(STOCK_INVENTORY_STATUS_LABELS[data.status])}</InfoRow>
            <InfoRow label={t("Дата создания")}>{inventoryDateText(data, language)}</InfoRow>
            <InfoRow label={t("Время")}>{data.forDayEnd ? t("На конец дня") : t("На начало дня")}</InfoRow>
            <InfoRow label={t("Комментарий")}>{data.comment || t("Комментариев нет")}</InfoRow>
          </div>
        </div>

        {data.items.length ? (
          <div className="min-w-0 flex-1 overflow-x-auto px-[30px] py-[5px]">
            <div className="min-w-[720px]">
              <div className={`${GRID} font-semibold`}>
                <div className={`col-span-2 ${FIRST}`}>{t("Наименование")}</div>
                <div className={`col-span-2 ${CELL}`}>{t("Серия")}</div>
                <div className={`col-span-1 ${CELL}`}>{t("Баланс (до)")}</div>
                <div className={`col-span-1 ${CELL}`}>{t("Баланс (после)")}</div>
                <div className={`col-span-2 ${CELL}`}>{t("Разница")}</div>
                <div className={`col-span-2 ${LAST}`}>
                  {t("Сумма")} {currencyLabel(data.currency)}
                </div>
                <Dots />
              </div>
              {data.items.map((item) => (
                <div key={item.id} className={GRID}>
                  <div className={`col-span-2 break-words ${FIRST}`}>{item.name}</div>
                  <div className={`col-span-2 ${CELL}`}>{item.series || "-"}</div>
                  <div className={`col-span-1 ${CELL}`}>{formatQty(item.balanceAmount, item.unit)}</div>
                  <div className={`col-span-1 ${CELL}`}>{formatQty(item.amount, item.unit)}</div>
                  <div className={`col-span-2 ${CELL}`}>{formatQty(item.diff, item.unit)}</div>
                  <div className={`col-span-2 ${LAST}`}>{formatSum(item.totalPrice)}</div>
                  <Dots />
                </div>
              ))}
              <div className={`${GRID} font-semibold`}>
                <div className={`col-span-2 ${FIRST}`}>{t("Итого")}:</div>
                <div className="col-span-6" />
                <div className={`col-span-2 ${LAST}`}>{formatSum(data.totalPrice)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="w-full min-w-0 pb-[20px] pt-[135px] text-center text-[13px] text-[#666]"
            style={{ background: "url(/robot-empty.png) no-repeat center 20px", backgroundSize: "155px" }}
          >
            {t("Товаров не найдено")}
          </div>
        )}
      </div>

      {verifyOpen && (
        <InventoryCommentDialog
          title={t("Подтверждения инвентаризации")}
          busy={busy}
          error={error}
          onSubmit={(comment) => void run("confirm", comment)}
          onClose={() => closeDialog("openVerifyDialog")}
        />
      )}
      {deleteOpen && (
        <InventoryCommentDialog
          title={t("Удаление")}
          busy={busy}
          error={error}
          onSubmit={(comment) => void run("delete", comment)}
          onClose={() => closeDialog("openCreateDialog")}
        />
      )}
      {cancelOpen && (
        <ConfirmDialog
          title={t("Подтверждение отмены")}
          kind="cancel"
          confirmLabel="Да"
          busy={busy}
          error={error}
          onConfirm={() => void run("cancel")}
          onClose={() => closeDialog("inventoryCancelOpen")}
        />
      )}
    </div>
  )
}
