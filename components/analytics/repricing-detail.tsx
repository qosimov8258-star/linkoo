"use client"

import { Ban, FileSpreadsheet } from "lucide-react"
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
    <span className="inline-flex items-center gap-[10px] whitespace-nowrap">
      <i className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: status === "finished" ? "#81c784" : "#e57373" }} />
      {t(REPRICING_STATUS_LABELS[status])}
    </span>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex min-h-[25px] items-center justify-between gap-3 leading-[25px]">
      <span>{label}</span>
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

  // Reference layout (measured on #/revaluation/88): 65 px title row with a single "sync" icon, 320 px info column,
  // lines Товар | Кол-во | Сумма до | Сумма после | Разница on a 340/169/170/170/170 px grid under a dashed rule.
  const cols = "grid grid-cols-[340px_169px_170px_170px_170px]"
  const exportLines = () =>
    downloadExcelTable(`${t("Переоценка")} № ${doc.id}`, [
      [t("Товар"), t("Кол-во"), t("Цена до"), t("Сумма до"), t("Новая цена"), t("Сумма после"), t("Разница")],
      ...doc.lines.map((line) => [line.name, line.amount, line.oldPrice ?? "", line.totalOld, line.price, line.totalNew, line.diff]),
    ])
  const iconButton = "relative -top-[2px] z-[3] flex h-12 w-12 items-center justify-center hover:opacity-70"
  return (
    <div className="bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex h-[67px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[6px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[18px] font-semibold">
          {t("Переоценка")} № {doc.id}
        </h3>
        <div className="relative z-[3] flex items-center">
          <button type="button" onClick={exportLines} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className={iconButton}>
            <FileSpreadsheet className="h-[22px] w-[22px] text-[#666]" aria-hidden />
          </button>
          {canEdit && (
            <button type="button" onClick={() => setConfirm("recalc")} title={t("Перерасчет по текущей дате")} aria-label={t("Перерасчет по текущей дате")} className={iconButton}>
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
                <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z" />
              </svg>
            </button>
          )}
          {/* Cancelling restores the old prices (and cancels the linked repricings derived from this one). */}
          {canEdit && doc.status === "finished" && (
            <button type="button" onClick={() => setConfirm("cancel")} title={t("Отменить")} aria-label={t("Отменить")} className={`${iconButton} text-[#666] hover:text-[#e57373]`}>
              <Ban className="h-[22px] w-[22px]" aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div className="flex">
        <div className="w-[321px] shrink-0 border-r border-[#efefef] pb-[24px]">
          <ul className="border-b border-[#efefef] px-[30px] pb-[13px] pt-[14.5px]">
            <Info label={t("Создал")}>{doc.createdBy || t("Не указано")}</Info>
            <Info label={t("Дата создания")}>{docDate(doc.createdAt, language)}</Info>
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
          <div className="px-[30px] pt-[20px]">
            <div className="font-semibold">{t("Комментарий")}:</div>
            <div className="mt-[2px] whitespace-pre-wrap">{doc.comment || t("Комментарий не отсутствует")}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pl-[4px] pr-[6px]">
          {doc.lines.length ? (
            <div className="min-w-[1021px] max-w-[1021px]">
              <div className={`${cols} border-b border-dotted border-[#c8c8c8] pb-[11px] pl-[10px] pt-[18px] font-semibold`}>
                <span>{t("Товар")}</span>
                <span>{t("Кол-во")}</span>
                <span>{t("Сумма до")}</span>
                <span>{t("Сумма после")}</span>
                <span>{t("Разница")}</span>
              </div>
              {doc.lines.map((line) => (
                <div key={line.key} className={`${cols} pb-[3px] pl-[10px] pt-[23px] leading-[17px]`}>
                  <span className="pr-3">{line.name}</span>
                  <span>{formatQty(line.amount, line.unit)}</span>
                  <span className="pr-3">
                    {/* The sum is in the document currency; the old price keeps its own (an entry may be in another currency). */}
                    {formatSum(line.totalOld, doc.currency)} (<b className="font-semibold">{line.oldPrice === null ? "—" : formatSum(line.oldPrice, line.oldCurrency)}</b>)
                  </span>
                  <span className="pr-3">
                    {formatSum(line.totalNew, doc.currency)} (<b className="font-semibold">{formatSum(line.price, doc.currency)}</b>)
                  </span>
                  <span>{formatSum(line.diff, doc.currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-[#9aa3b6]">{t("Товаров нет")}</div>
          )}
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
