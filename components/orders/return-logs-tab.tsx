"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// The return card's «Логи» tab, drawn like Linko's (#/return/<id>?tab=logs): one card per log row of
// GET /api/client-returns/<id>/logs, in the order the server gives (Linko's own order for copied rows).
// Each card: «Возврат:» with the action chip, «Статус:» with the status icon, «Кем», «Когда», «Сумма» (the amount the
// return had after that action) and, when there is one, a «Комментарий:» line.

export type ReturnLogEntry = {
  id: number
  action: string
  status: string
  totalPrice: number
  currency: string
  comment: string
  createdBy: string
  createdAt: string
}

// Linko's chips: success #81c784, begin #64b5f6, error #e57373 (text and 1 px border).
const ACTION_CHIP: Record<string, { label: string; color: string }> = {
  created: { label: "Создан", color: "#81c784" },
  updated: { label: "Обновленный", color: "#64b5f6" },
  accepted_to_stock: { label: "Принят на склад", color: "#64b5f6" },
  canceled: { label: "Отменен", color: "#e57373" },
  cancel_accept: { label: "Отменил приемку на склад", color: "#81c784" },
  deleted: { label: "Удаленный", color: "#e57373" },
}

// Material icons Linko draws before the status: access_time (pending, in progress), local_shipping (completed),
// block (cancelled).
const CLOCK = "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
const TRUCK =
  "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
const BLOCK = "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM4 12c0-4.4 3.6-8 8-8 1.8 0 3.5.6 4.9 1.7L5.7 16.9C4.6 15.5 4 13.8 4 12zm8 8c-1.8 0-3.5-.6-4.9-1.7L18.3 7.1C19.4 8.5 20 10.2 20 12c0 4.4-3.6 8-8 8z"
const STATUS: Record<string, { label: string; icon: string; color: string }> = {
  pending: { label: "Ожидает", icon: CLOCK, color: "#f0ad4e" },
  in_progress: { label: "В процессе", icon: CLOCK, color: "#f0ad4e" },
  accepted: { label: "Завершен", icon: TRUCK, color: "#f0ad4e" },
  cancelled: { label: "Отменен", icon: BLOCK, color: "#e57373" },
}

// moment's Russian short months ("23 янв. 2026, 16:10").
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** A stored moment (ISO UTC with "Z", or "YYYY-MM-DD HH:MM:SS" UTC) as Linko prints it, in local time. */
function whenText(value: string): string {
  if (!value) return ""
  const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getDate())} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Linko's numberFormat: the decimals of Настройки → Округление сумм (its ROUND_AMOUNT_FOR_CURRENCY). */
function amountText(value: number): string {
  return value ? formatMoney(value) : "0"
}

/** `refreshKey`: a value that changes when the return changed (the card passes its row as JSON), so the log is read
 * again after an action. */
export function ReturnLogsTab({ returnId, refreshKey }: { returnId: number; refreshKey?: unknown }) {
  const { t } = useLanguage()
  const [logs, setLogs] = useState<ReturnLogEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    void fetch(`/api/client-returns/${returnId}/logs`)
      .then(async (response) => (response.ok ? ((await response.json()) as ReturnLogEntry[]) : []))
      .catch(() => [] as ReturnLogEntry[])
      .then((rows) => alive && setLogs(rows))
    return () => {
      alive = false
    }
  }, [returnId, refreshKey])

  if (logs === null) {
    return (
      <div className="flex items-center justify-center py-[50px]">
        <Loader2 className="h-[30px] w-[30px] animate-spin text-[#1E4A9A]" />
      </div>
    )
  }
  return (
    <div className="flex w-full flex-col pt-[15px] text-[13px] text-[#333]">
      {logs.map((log) => {
        const chip = ACTION_CHIP[log.action]
        const status = STATUS[log.status]
        return (
          <div
            key={log.id}
            className="mb-[20px] grid grid-cols-[repeat(auto-fill,minmax(360px,450px))] justify-between gap-y-[7px] rounded-[10px] border border-[#E5E8F1] bg-[#FBFBFB] p-[20px] [&_p]:leading-[2]"
          >
            <div className="flex flex-row">
              <div className="flex items-center">
                <span className="font-semibold">{t("Возврат")}: </span>
                {chip ? (
                  <span className="rounded-[15px] px-[7px] py-[1px]">
                    <span className="rounded-[15px] border px-[7px] py-[1px]" style={{ color: chip.color, borderColor: chip.color }}>
                      {t(chip.label)}
                    </span>
                  </span>
                ) : (
                  <span className="rounded-[15px] px-[7px] py-[1px]">{t("Не установлен")}</span>
                )}
              </div>
              <div className="ml-[10px] flex flex-row items-center">
                <span className="font-semibold">{t("Статус")}: </span>
                {status ? (
                  <div className="flex items-center">
                    <span className="block h-[33px] w-[33px] p-[5px]">
                      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]" style={{ fill: status.color }} aria-hidden>
                        <path d={status.icon} />
                      </svg>
                    </span>
                    <span>{t(status.label)}</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-start">
              <p>
                <span className="font-semibold">{t("Кем")}: </span>
                {log.createdBy || t("Не указан")}
              </p>
              <div className="ml-[20px] flex items-center">
                <span className="font-semibold">{t("Когда")}: </span>
                <p className="ml-[5px]">{t(whenText(log.createdAt))}</p>
              </div>
              <div className="ml-[10px] flex flex-row items-center [&_span]:mr-[5px]">
                <span className="font-semibold">{t("Сумма")}:</span> {amountText(log.totalPrice)} {log.currency}
              </div>
            </div>
            {log.comment ? (
              <div className="col-start-1 flex items-center [&_span]:mr-[5px]" style={{ gridColumnEnd: "span col1-end" }}>
                <span className="font-semibold">{t("Комментарий")}: </span>
                <p>{log.comment}</p>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
