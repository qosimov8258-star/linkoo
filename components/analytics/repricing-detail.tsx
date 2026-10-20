"use client"

import { Ban, Calculator, FileSpreadsheet, X } from "lucide-react"
import { useState, type ReactNode } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { docDate, formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { mutateJson, mutationMessage } from "./price-lists-data"
import { REPRICINGS_API, REPRICING_STATUS_LABELS, type RepricingDetail, type RepricingErrorBody, type RepricingStatus } from "./repricing-data"

// Detail of a repricing (demo c143 module 5206): "Переоценка № N" + "Перерасчет по текущей дате"
// (confirm "№ N", demo PUT main/reprice/:id/recalc/) and "Отменить" (demo DELETE: status "отменен",
// old prices restored; refused when a later repricing touched the items); left Создал | Дата
// создания | Прайс лист | Сумма переоценки | Статус + Комментарий ("Комментарий не отсутствует");
// right Товар | Кол-во | Сумма до (цена) | Сумма после (цена) | Разница.

export function RepricingStatusLabel({ status }: { status: RepricingStatus }) {
  const { t } = useLanguage()
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: status === "finished" ? "#81c784" : "#e57373" }} />
      {t(REPRICING_STATUS_LABELS[status])}
    </span>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap justify-between gap-3 leading-[25px]">
      <span className="text-[#586174]">{label}</span>
      <span className="max-w-[60%] text-right font-semibold">{children}</span>
    </li>
  )
}

export function RepricingDetailPanel({
  id,
  canEdit,
  onClose,
  onOpen,
  onChanged,
  notify,
}: {
  id: number
  canEdit: boolean
  onClose: () => void
  onOpen: (id: number) => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<RepricingDetail>(`${REPRICINGS_API}/${id}`)
  const [confirm, setConfirm] = useState<"recalc" | "cancel" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const doc = detail.data

  async function run(kind: "recalc" | "cancel") {
    setBusy(true)
    setError("")
    const result = kind === "recalc" ? await mutateJson("PUT", `${REPRICINGS_API}/${id}/recalc`) : await mutateJson("DELETE", `${REPRICINGS_API}/${id}`)
    setBusy(false)
    if (!result.ok) {
      const conflicts = (result.body as RepricingErrorBody | null)?.conflicts ?? []
      return setError(`${t(mutationMessage(result))}${conflicts.length ? `: ${conflicts.map((item) => `№ ${item}`).join(", ")}` : ""}`)
    }
    setConfirm(null)
    notify(kind === "recalc" ? t("Успешно сохранено") : t("Переоценка отменена"))
    onChanged()
  }

  if (detail.loading && !doc) return <LoadingBlock className="py-10" />
  if (detail.error || !doc) return <ErrorBlock error={detail.error || "Переоценка не найдена"} onRetry={detail.reload} />

  const exportLines = () =>
    downloadExcelTable(`${t("Переоценка")} № ${doc.id}`, [
      [t("Товар"), t("Кол-во"), t("Цена до"), t("Сумма до"), t("Новая цена"), t("Сумма после"), t("Разница")],
      ...doc.lines.map((line) => [line.name, line.amount, line.oldPrice ?? "", line.totalOld, line.price, line.totalNew, line.diff]),
    ])
  const iconButton = "flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-white disabled:opacity-40"
  return (
    <div className="rounded-sm bg-white text-[14px] shadow-sm">
      <header className="flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] pl-6 pr-3">
        <b className="text-[18px] text-[#333]">
          {t("Переоценка")} № {doc.id}
        </b>
        <div className="flex items-center gap-1">
          <button type="button" onClick={exportLines} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className={iconButton}>
            <FileSpreadsheet className="h-5 w-5" />
          </button>
          {canEdit && (
            <button type="button" onClick={() => setConfirm("recalc")} title={t("Перерасчет по текущей дате")} aria-label={t("Перерасчет по текущей дате")} className={iconButton}>
              <Calculator className="h-5 w-5" />
            </button>
          )}
          {canEdit && doc.status === "finished" && (
            <button type="button" onClick={() => setConfirm("cancel")} title={t("Отменить")} aria-label={t("Отменить")} className={`${iconButton} hover:text-[#e57373]`}>
              <Ban className="h-5 w-5" />
            </button>
          )}
          <button type="button" onClick={onClose} title={t("Закрыть")} aria-label={t("Закрыть")} className={iconButton}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>
      <div className="flex flex-col lg:flex-row">
        <div className="lg:w-[320px] lg:shrink-0">
          <ul className="border-b border-[#efefef] px-6 py-4">
            <Info label={t("Создал")}>{doc.createdBy || t("Не указано")}</Info>
            <Info label={t("Дата создания")}>{docDate(doc.createdAt, language, true)}</Info>
            <Info label={t("Прайс лист")}>{doc.priceList || t("Не указано")}</Info>
            <Info label={t("Сумма переоценки")}>{formatSum(doc.total, doc.currency)}</Info>
            <Info label={t("Статус")}>
              <span style={{ color: doc.status === "finished" ? "#81c784" : "#e57373" }}>{t(REPRICING_STATUS_LABELS[doc.status])}</span>
            </Info>
            {doc.status === "canceled" && doc.canceledAt && (
              <Info label={t("Отменил")}>
                {doc.canceledBy} · {docDate(doc.canceledAt, language, true)}
              </Info>
            )}
            {doc.source === "supplier_incoming" && <Info label={t("Источник")}>{t("Наценка поставки")}</Info>}
            {doc.parentId && (
              <Info label={t("Связанная переоценка")}>
                <button type="button" onClick={() => onOpen(doc.parentId!)} className="text-[rgb(79,113,220)] hover:underline">
                  № {doc.parentId}
                </button>
              </Info>
            )}
            {doc.children.length > 0 && (
              <Info label={t("Связанные переоценки")}>
                {doc.children.map((child) => (
                  <button key={child} type="button" onClick={() => onOpen(child)} className="ml-2 text-[rgb(79,113,220)] hover:underline">
                    № {child}
                  </button>
                ))}
              </Info>
            )}
          </ul>
          <div className="px-6 py-5">
            <div className="mb-1 font-semibold">{t("Комментарий")}:</div>
            <div className="whitespace-pre-wrap text-[#586174]">{doc.comment || t("Комментарий не отсутствует")}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto border-t border-[#efefef] px-4 py-2 lg:border-l lg:border-t-0">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-dashed border-[#d8dee7] text-left font-semibold">
                <th className="w-[34%] py-3 pr-3">{t("Товар")}</th>
                <th className="py-3 pr-3">{t("Кол-во")}</th>
                <th className="py-3 pr-3">{t("Сумма до")}</th>
                <th className="py-3 pr-3">{t("Сумма после")}</th>
                <th className="py-3">{t("Разница")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.key} className="border-b border-dashed border-[#e1e5eb]">
                  <td className="py-3 pr-3">{line.name}</td>
                  <td className="whitespace-nowrap py-3 pr-3">{formatQty(line.amount, line.unit)}</td>
                  <td className="whitespace-nowrap py-3 pr-3">
                    {formatSum(line.totalOld, line.oldCurrency)} (<b>{line.oldPrice === null ? "—" : formatSum(line.oldPrice, line.oldCurrency)}</b>)
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3">
                    {formatSum(line.totalNew, doc.currency)} (<b>{formatSum(line.price, doc.currency)}</b>)
                  </td>
                  <td className="whitespace-nowrap py-3" style={{ color: line.diff < 0 ? "#e57373" : undefined }}>
                    {formatSum(line.diff, doc.currency)}
                  </td>
                </tr>
              ))}
              {!doc.lines.length && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[#9aa3b6]">
                    {t("Товаров нет")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {doc.recalculatedAt && (
            <p className="py-2 text-right text-[12px] text-[#9aa3b6]">
              {t("Перерасчет по текущей дате")}: {docDate(doc.recalculatedAt, language, true)}
            </p>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm === "recalc" ? t("Перерасчет по текущей дате") : t("Отменить переоценку")}
          text={
            confirm === "recalc"
              ? `№ ${doc.id}`
              : doc.children.length
                ? // The linked documents derived from this one are cancelled with it (their lists go back too).
                  `${t("Старые цены товаров будут восстановлены.")} ${t("Связанные переоценки тоже будут отменены")}: ${doc.children.map((child) => `№ ${child}`).join(", ")}`
                : t("Старые цены товаров будут восстановлены.")
          }
          confirmLabel={confirm === "recalc" ? "Подтвердить" : "Отменить переоценку"}
          tone={confirm === "recalc" ? "blue" : "red"}
          busy={busy}
          error={error}
          onConfirm={() => void run(confirm)}
          onClose={() => {
            setConfirm(null)
            setError("")
          }}
        />
      )}
    </div>
  )
}
