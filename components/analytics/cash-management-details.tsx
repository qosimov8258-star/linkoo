"use client"

import Link from "next/link"
import { cloneElement, isValidElement, type ReactNode } from "react"

import { useCashOperation } from "@/components/analytics/cash/use-cash"
import { CashModal, EmptyBlock, ErrorBlock, LoadingBlock, cashCommentText, formatCash, formatCashDate } from "@/components/analytics/cash-management-shared"
import { CATEGORY_OPTIONS, type CashOperation, type CategoryOptionKey } from "@/lib/cash/types"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Tarkibi" / "Детали" column of the cash list (demo module 3840 rows + 1622
// TransactionsFormat): Касса (only in "Общий объем"), Поставщик, then the
// comma-separated Описание by operation type, Категория (linked by the
// category's first option), Филиал, Организация, Деньги за период, период,
// Комментарий; one cashbox's list adds the Клиент line, the unverified dialog
// Создал / Клиент / Поставщик. Plus the two category popups: "Расходы на
// сотрудников" and "Детализация".

export type DetailsPopup = { kind: "staff" | "children"; operation: CashOperation }

const linkClass = "text-[#1E4A9A] hover:underline"

export const clientHref = (id: number | null, name: string) =>
  id ? `/analytics/client-balance?openClient=${id}&clientName=${encodeURIComponent(name)}` : "/analytics/client-balance"
export const supplierHref = (id: number | null, name: string) =>
  id ? `/analytics/supplier-balance?openProvider=${id}&providerName=${encodeURIComponent(name)}` : "/analytics/supplier-balance"
const ORDERS_HREF = "/analytics/sales"
const SUPPLIES_HREF = "/analytics/supplier-incomings"
const LOYALTY_HREF = "/analytics/loyalty-card"

function Ext({ href, children, bold }: { href: string; children: ReactNode; bold?: boolean }) {
  return (
    <Link href={href} target="_blank" className={`${linkClass} ${bold ? "font-bold" : ""}`}>
      {children}
    </Link>
  )
}

function Item({
  label,
  children,
  raw,
  comma,
}: {
  label: string
  children: ReactNode
  /** The reference prints this line in Russian whatever the language. */
  raw?: boolean
  /** Trailing "," kept on the item's own line (the reference's ::after). */
  comma?: boolean
}) {
  const { t } = useLanguage()
  return (
    // Every item is an inline block like the reference's: a long Описание / Комментарий wraps inside its own block.
    <span
      className={`${["Описание", "Комментарий"].includes(label) ? "inline-block max-w-full align-top" : "inline-block whitespace-nowrap align-top"} ${comma ? "mr-[7px]" : ""}`}
      {...(raw ? { "data-no-translate": "" } : {})}
    >
      <strong className="font-semibold text-[#17233b]">{raw ? label : t(label)}:</strong> {children}
      {comma ? "," : null}
    </span>
  )
}

/** First option of the category that applies to the operation direction (decides the category link). */
export function firstOption(operation: CashOperation): CategoryOptionKey | undefined {
  const kind = operation.amount < 0 ? "expense" : "income"
  return operation.category?.options.find((key) => CATEGORY_OPTIONS[key]?.[kind]) ?? operation.category?.options[0]
}

/** Описание by type (demo TransactionsFormat). */
export function OperationDescription({ operation, onOpenAcceptance }: { operation: CashOperation; onOpenAcceptance?: (operation: CashOperation) => void }) {
  const { t } = useLanguage()
  const client = operation.client
  const clientLink = client ? <Ext href={clientHref(client.id, client.name)}>{client.name}</Ext> : null
  switch (operation.type) {
    case 1:
      // The reference names no receiving cashbox here.
      return <span>{t("Перевод с кассы")}</span>
    case 2:
      return (
        <span>
          {t("Перевод с")} {operation.transfer?.otherCashbox ?? ""}
        </span>
      )
    case 3:
      return (
        <span>
          {clientLink} {t("Заказ")} {operation.orderId ? <Ext href={ORDERS_HREF}>№ {operation.orderId}</Ext> : null}
        </span>
      )
    case 6:
      return (
        <span>
          {t("Приход на счет клиента")} {clientLink}
        </span>
      )
    case 8: {
      const label = `Принято денег с ${operation.employee?.name ?? ""}`.trim()
      // Only an acceptance with its accepted payments has an info card; elsewhere (Баланс кассы) the reference links to
      // the cash page with that card open.
      if (operation.source !== "acceptance") return <strong data-no-translate>{label}</strong>
      if (!onOpenAcceptance)
        return (
          <Ext href={`/analytics/cash-management?openTransactionInfo=${operation.id}`}>
            <span data-no-translate>{label}</span>
          </Ext>
        )
      return onOpenAcceptance ? (
        <button type="button" data-no-translate onClick={() => onOpenAcceptance(operation)} className={`${linkClass} text-left`}>
          {label}
        </button>
      ) : (
        <strong data-no-translate>{label}</strong>
      )
    }
    case 9:
      return (
        <span>
          {t("Доп. расход")}
          {operation.supplyExpenseId ? ` № ${operation.supplyExpenseId}` : ""} {t("на поставку")}{" "}
          {operation.supplyId ? <Ext href={SUPPLIES_HREF}>№ {operation.supplyId}</Ext> : null}
        </span>
      )
    case 10:
      return (
        <span>
          {t("Расход на поставку")} {operation.supplyId ? <Ext href={SUPPLIES_HREF}>№ {operation.supplyId}</Ext> : null}
        </span>
      )
    case 22:
      return (
        <span>
          {t("Выдача денег для Кэшбека")} {client ? <Ext href={`${LOYALTY_HREF}?search=${encodeURIComponent(client.name)}`}>{client.name}</Ext> : null}
        </span>
      )
    default:
      return <span>{t(operation.title)}</span>
  }
}

function CategoryValue({ operation, onPopup }: { operation: CashOperation; onPopup?: (popup: DetailsPopup) => void }) {
  const category = operation.category
  if (!category?.name) return null
  const name = category.name
  switch (firstOption(operation)) {
    case "order":
      return <Ext href={ORDERS_HREF}>{name}</Ext>
    case "supply":
      return operation.supplyId ? <Ext href={SUPPLIES_HREF}>{name}</Ext> : <span>{name}</span>
    case "client":
      return operation.client ? <Ext href={clientHref(operation.client.id, operation.client.name)}>{name}</Ext> : <span>{name}</span>
    case "provider":
      return operation.supplier ? <Ext href={supplierHref(operation.supplier.id, operation.supplier.name)}>{name}</Ext> : <span>{name}</span>
    // The reference links these categories whether or not the operation has lines (the popup then lists none).
    case "staff_expense":
    case "staff_income":
      return onPopup ? (
        <button type="button" onClick={() => onPopup({ kind: "staff", operation })} className={linkClass}>
          {name}
        </button>
      ) : (
        <span>{name}</span>
      )
    case "transaction_child":
      return onPopup ? (
        <button type="button" onClick={() => onPopup({ kind: "children", operation })} className={linkClass}>
          {name}
        </button>
      ) : (
        <span>{name}</span>
      )
    default:
      return <span>{name}</span>
  }
}

/** The "Детали" cell. `showCashbox` = "Общий объем" view; `extended` = the unverified dialog (Создал, Клиент, Поставщик
 * lines); `cashbox` = the Баланс кассы detail (no Касса / Организация, Клиент and Поставщик lines below). Block lines
 * (Касса, Поставщик / Создал, Клиент, Поставщик) frame the comma-separated description as in the reference's row. */
export function OperationDetails({
  operation,
  showCashbox,
  extended = false,
  cashbox = false,
  onOpenAcceptance,
  onPopup,
}: {
  operation: CashOperation
  showCashbox: boolean
  extended?: boolean
  cashbox?: boolean
  onOpenAcceptance?: (operation: CashOperation) => void
  onPopup?: (popup: DetailsPopup) => void
}) {
  const { t, language } = useLanguage()
  const transfer = operation.transfer
  // The reference's payment for a supply (type 10) names no supplier.
  const supplier = operation.type !== 10 && operation.supplier?.name ? operation.supplier.name : ""
  const before: ReactNode[] = []
  const parts: ReactNode[] = []
  const after: ReactNode[] = []
  if ((showCashbox || extended) && !cashbox) before.push(<Item key="cashbox" label="Касса">{operation.cashbox.name}</Item>)
  if (supplier && !extended && !cashbox) before.push(<Item key="supplier" label="Поставщик">{supplier}</Item>)
  // Type 11 (supplier income) has no "Описание" in the reference.
  if (operation.type !== 11)
    parts.push(
      <Item key="description" label="Описание">
        <OperationDescription operation={operation} onOpenAcceptance={onOpenAcceptance} />
      </Item>,
    )
  if (operation.category?.name)
    parts.push(
      <Item key="category" label="Категория">
        <CategoryValue operation={operation} onPopup={onPopup} />
      </Item>,
    )
  if (operation.branch) parts.push(<Item key="branch" label="Филиал">{operation.branch}</Item>)
  if (operation.organization && !cashbox) parts.push(<Item key="organization" label="Организация">{operation.organization}</Item>)
  if (transfer?.accumulatedFrom || transfer?.accumulatedTo)
    parts.push(
      <Item key="accumulated" label="Деньги за период" raw>
        с {transfer.accumulatedFrom} по {transfer.accumulatedTo}
      </Item>,
    )
  if (operation.amortization)
    parts.push(
      <Item key="amortization" label="период">
        {formatDotDate(operation.amortization.from)} — {formatDotDate(operation.amortization.to)}
      </Item>,
    )
  if (operation.comment) parts.push(<Item key="comment" label="Комментарий">{cashCommentText(operation.comment, t)}</Item>)
  if (extended && operation.createdBy) after.push(<Item key="created" label="Создал">{operation.createdBy}</Item>)
  // One cashbox's list and the unverified dialog print the client on a line of its own (plain text).
  if ((extended || cashbox || !showCashbox) && operation.client?.name) after.push(<Item key="client" label="Клиент">{operation.client.name}</Item>)
  if ((extended || cashbox) && supplier) after.push(<Item key="supplier-after" label="Поставщик">{supplier}</Item>)
  return (
    <div className="text-[13px] leading-[16px] text-[#17233b]">
      {before.map((line, index) => (
        <span key={`b${index}`} className="block">
          {line}
        </span>
      ))}
      {parts.length > 0 && (
        <div>
          {parts.map((part, index) => (
            <span key={index}>
              {isValidElement<{ comma?: boolean }>(part) && index < parts.length - 1 ? cloneElement(part, { comma: true }) : part}
            </span>
          ))}
        </div>
      )}
      {after.map((line, index) => (
        <span key={`a${index}`} className="block">
          {line}
        </span>
      ))}
      {operation.isDeleted && (
        <span className="ml-2 inline-block rounded bg-[#fdecec] px-2 text-[11px] font-semibold uppercase text-[#e57373]">
          {t("Удалено")}
          {operation.deletedAt ? ` · ${formatCashDate(operation.deletedAt, language)}` : ""}
        </span>
      )}
    </div>
  )
}

/** "Расходы на сотрудников" (Сотрудник | Сумма) / "Детализация" (Наименование | Сумма). */
export function OperationPopupDialog({ popup, onClose }: { popup: DetailsPopup; onClose: () => void }) {
  const { t } = useLanguage()
  const { data, loading, error, reload } = useCashOperation(popup.operation.key)
  const staff = popup.kind === "staff"
  const currency = popup.operation.currency
  const rows = staff
    ? (data?.staff ?? []).map((row) => ({ name: row.employee.name, amount: row.amount, currency: row.currency || currency }))
    : (data?.children ?? []).map((row) => ({ name: row.name, amount: row.amount, currency }))
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <CashModal title={t(staff ? "Расходы на сотрудников" : "Детализация")} onClose={onClose} size="md" zIndex={150}>
      {loading && !data && <LoadingBlock className="py-10" />}
      {error && <ErrorBlock error={error} onRetry={reload} />}
      {data && !rows.length && <EmptyBlock text="По вашему запросу ничего не найдено" className="py-10" />}
      {rows.length > 0 && (
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
              <th className="py-2 pr-3 font-semibold">{t(staff ? "Сотрудник" : "Наименование")}</th>
              <th className="py-2 text-right font-semibold">{t("Сумма")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-dashed border-[#e1e5eb]">
                <td className="py-2 pr-3">{row.name}</td>
                <td className="py-2 text-right whitespace-nowrap">{formatCash(row.amount, row.currency)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 font-semibold">{t("Итого")}</td>
              <td className="py-2 text-right font-semibold whitespace-nowrap">{formatCash(total, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </CashModal>
  )
}
