"use client"

import { useState } from "react"
import { Check, Send, Undo2, X } from "lucide-react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, FormField, LoadingBlock, inputClass } from "@/components/analytics/cash-management-shared"
import { planDate, planQty } from "@/components/analytics/stock-plan-state"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_TYPE_LABELS, isHistoryTab, isReceiveTab, type PlanItemDetail, type PlanTaskRow, type PlanTaskTab } from "@/lib/stock-plan-types"

// Expanded row of a task tab (demo 4891 / 4894): the document's products
// (Товар | Тип товара | Кол-во, "Общее количество" when they share a unit) and
// the side panel (who / when, Комментарий), plus the row action:
//   Приемка           Поставка → PATCH /api/supplier-incomings/[id] {action:"accept"}
//                     Передача → POST /api/internal-transfers/[id]/action {action:"accept"}
//   Передача          Передача → … {action:"give"}; Заказ is read-only (orders module)
//   История Приемки   Поставка → {action:"unaccept"}; Передача → {action:"cancel_accepted"}
//   История Передачи  Передача still 'в пути' → {action:"cancel_given"}

type PlanAction = {
  label: string
  /** Demo tooltip / dialog title: "Подтвердить Запрос" / "Отменить Запрос". */
  title: string
  tone: "blue" | "red"
  success: string
  url: string
  method: "PATCH" | "POST"
  body: Record<string, string>
  /** Transfer give / accept: the dialog also asks for the date and a comment (POST …/action {date?, comment?}). */
  withNote: boolean
}

export function planActionFor(tab: PlanTaskTab, row: Pick<PlanTaskRow, "type" | "id" | "status">): PlanAction | null {
  const transfer = (action: string) => ({ url: `/api/internal-transfers/${row.id}/action`, method: "POST" as const, body: { action }, withNote: action === "give" || action === "accept" })
  const supply = (action: string) => ({ url: `/api/supplier-incomings/${row.id}`, method: "PATCH" as const, body: { action }, withNote: false })
  const confirm = { label: "Принять", title: "Подтвердить Запрос", tone: "blue" as const, success: "Успешно принять" }
  const cancel = { label: "Отменить Запрос", title: "Отменить Запрос", tone: "red" as const, success: "Успешно отменено" }
  if (tab === "receive" && row.type === "supply" && row.status === "ожидает") return { ...confirm, ...supply("accept") }
  if (tab === "receive" && row.type === "transfer" && row.status === "в пути") return { ...confirm, ...transfer("accept") }
  if (tab === "transfer" && row.type === "transfer" && row.status === "потвержден") return { ...confirm, label: "Передать", success: "Успешно передан", ...transfer("give") }
  if (tab === "receive_history" && row.type === "supply" && row.status === "принят") return { ...cancel, ...supply("unaccept") }
  if (tab === "receive_history" && row.type === "transfer" && row.status === "принят") return { ...cancel, ...transfer("cancel_accepted") }
  if (tab === "transfer_history" && row.type === "transfer" && row.status === "в пути") return { ...cancel, label: "Отменить", ...transfer("cancel_given") }
  return null
}

function Info({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[#586174]">{t(label)}:</span>
      <span className="text-right font-semibold">{value || t("Не указано")}</span>
    </div>
  )
}

export function StockPlanDetail({
  tab,
  row,
  canWrite,
  onClose,
  onDone,
}: {
  tab: PlanTaskTab
  row: PlanTaskRow
  canWrite: boolean
  onClose: () => void
  /** After a successful action: snackbar text (the list reloads). */
  onDone: (message: string) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<PlanItemDetail>(`/api/stock/plan/item?type=${row.type}&id=${row.id}`)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState({ date: todayIso(), comment: "" })
  const action = canWrite ? planActionFor(tab, row) : null
  const data = detail.data
  const receive = isReceiveTab(tab)

  const run = async () => {
    if (!action) return
    setBusy(true)
    setError("")
    try {
      const body: Record<string, string> = { ...action.body }
      if (action.withNote) {
        // The transfer endpoint dates the action now unless another day is chosen.
        if (note.date && note.date !== todayIso()) body.date = note.date
        if (note.comment.trim()) body.comment = note.comment.trim()
      }
      const response = await fetch(action.url, { method: action.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(result?.error || (response.status === 404 ? "Документ не найден" : `HTTP ${response.status}`))
      setConfirming(false)
      onDone(action.success)
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusy(false)
    }
  }

  const products = data?.products ?? []
  const units = new Set(products.map((product) => product.unit))
  const total = products.reduce((sum, product) => sum + product.qty, 0)
  const info: Array<[string, string]> = []
  if (data) {
    if (receive) info.push(["От кого", data.fromName])
    else info.push(["Кому", data.toName])
    if (tab === "receive_history") info.push(["Дата приемки", planDate(data.acceptedAt, language)], ["Принял", data.acceptedBy])
    if (tab === "transfer_history") info.push(["Дата передачи", planDate(data.givenAt, language)], ["Передал", data.givenBy])
    if (tab === "receive" && row.type === "transfer") info.push(["Дата передачи", planDate(data.givenAt, language)], ["Передал", data.givenBy])
    if (row.type !== "supply") info.push(["Дата доставки", planDate(data.plannedDate, language)], ["Доставщик", data.deliverer])
    if (tab === "transfer_history" && data.acceptedAt) info.push(["Дата приемки", planDate(data.acceptedAt, language)], ["Принял", data.acceptedBy])
    info.push(["Создал", data.createdBy], ["Дата создания", planDate(data.createdAt, language)])
  }
  const Icon = action?.tone === "red" ? Undo2 : tab === "transfer" ? Send : Check

  return (
    <div className="rounded-md border border-[#e1e5eb] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#efefef] px-4 py-2 md:px-6">
        <span className="font-semibold">
          {t(PLAN_TYPE_LABELS[row.type])} № {row.id}
        </span>
        {row.type === "order" && !isHistoryTab(tab) && <span className="text-[13px] text-[#9aa3b6]">{t("Заказы обрабатываются в модуле заказов")}</span>}
        <div className="ml-auto flex items-center gap-2">
          {action && (
            <button
              type="button"
              onClick={() => {
                setError("")
                setNote({ date: todayIso(), comment: "" })
                setConfirming(true)
              }}
              title={`${t(action.title)} №${row.id}`}
              className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95 ${action.tone === "red" ? "bg-[#e57373]" : "bg-[rgb(79,113,220)]"}`}
            >
              <Icon className="h-4 w-4" /> {t(action.label)}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {detail.loading && !data && <LoadingBlock className="py-10" />}
      {detail.error && !detail.loading && <ErrorBlock error={detail.error} onRetry={detail.reload} className="py-6" />}
      {data && (
        <div className="flex flex-col md:flex-row">
          <div className="min-w-0 flex-1 overflow-x-auto px-4 pb-3 md:basis-[70%] md:px-6">
            {products.length ? (
              <table className="w-full min-w-[480px] text-[14px]">
                <thead>
                  <tr className="border-b border-dotted border-[#cfd5df] font-semibold">
                    <td className="py-3 pr-3">{t("Товар")}</td>
                    <td className="py-3 pr-3">{t("Тип товара")}</td>
                    <td className="py-3 text-right">{t("Кол-во")}</td>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={`${product.key}-${index}`} className="border-b border-dotted border-[#cfd5df] last:border-b-0">
                      <td className="py-3 pr-3">{product.name}</td>
                      <td className="py-3 pr-3 text-[#586174]">{product.productType || "—"}</td>
                      <td className="whitespace-nowrap py-3 text-right">{planQty(product.qty, product.unit, t)}</td>
                    </tr>
                  ))}
                </tbody>
                {units.size === 1 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="py-3 font-bold">
                        {t("Общее количество")} {planQty(total, [...units][0], t)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <p className="py-10 text-center text-[13px] text-[#999]">{t("Товаров не найдено")}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-[#efefef] px-4 py-4 text-[14px] md:basis-[30%] md:border-l md:border-t-0 md:px-6">
            {info.map(([label, value]) => (
              <Info key={label} label={label} value={value} />
            ))}
            <span className="mt-3 font-semibold">{t("Комментарий")}:</span>
            <span className="whitespace-pre-wrap text-[#586174]">{data.comment || t("Комментарий отсутствует")}</span>
          </div>
        </div>
      )}

      {confirming && action && (
        <ConfirmDialog
          title={`${t(action.title)} №${row.id}`}
          text={`${t("Запрос")} № ${row.id}: ${t(PLAN_TYPE_LABELS[row.type])}, ${row.warehouse}`}
          confirmLabel={action.label}
          tone={action.tone}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setConfirming(false)}
        >
          {action.withNote && (
            <div className="mt-4 flex flex-col gap-3">
              <FormField label={t("Дата")}>
                <input type="date" value={note.date} max={todayIso()} onChange={(event) => setNote((value) => ({ ...value, date: event.target.value }))} className={inputClass} />
              </FormField>
              <FormField label={t("Комментарий")}>
                <textarea value={note.comment} onChange={(event) => setNote((value) => ({ ...value, comment: event.target.value }))} rows={2} className={`${inputClass} h-auto py-2`} />
              </FormField>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
