"use client"

import { useCallback, useEffect, useState } from "react"

import { askDelete } from "@/lib/ask-confirm"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type DebtLimit = { id: number; organization: string; amount: number }

const formatAmount = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value).replace(/[  ]/g, " ")

/**
 * "Лимит долга" of the client panel (ФИНАНСОВЫЕ НАСТРОЙКИ): the limits per organization from `market/debt_limit/?market=<id>`
 * with a delete icon per row; the reference has no add button here.
 */
export function ClientDebtLimits({ clientId }: { clientId: number }) {
  const { t } = useLanguage()
  const [limits, setLimits] = useState<DebtLimit[] | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/client-debt-limits?client=${clientId}`)
      const data = response.ok ? ((await response.json()) as { results: DebtLimit[] }) : { results: [] }
      setLimits(data.results)
    } catch {
      setLimits([])
    }
  }, [clientId])

  useEffect(() => {
    setLimits(null)
    void load()
  }, [load])

  const remove = async (limit: DebtLimit) => {
    if (!(await askDelete())) return
    const response = await fetch(`/api/client-debt-limits/${limit.id}`, { method: "DELETE" })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      notify(body.error ?? t("Не удалось удалить"))
      return
    }
    await load()
  }

  return (
    <>
      <h3 className="mt-[5px] text-[15px] font-semibold">{t("Лимит долга")}</h3>
      {limits === null ? null : limits.length === 0 ? (
        <div className="flex flex-col items-center py-[22px] text-[#666]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[150px]" />
          <span className="mt-[30px]">{t("По вашему запросу ничего не найдено...")}</span>
        </div>
      ) : (
        <div className="mb-5 text-[13px] text-[#333]">
          <div className="mb-[39px] mt-[21px] flex font-semibold">
            <div className="w-[217px]">{t("Организация")}</div>
            <div className="w-[130px]">{t("Лимит")}</div>
          </div>
          {limits.map((limit) => (
            <div key={limit.id} className="relative flex h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5]">
              <div className="w-[217px] truncate">{limit.organization}</div>
              <div className="w-[130px]">{formatAmount(limit.amount)}</div>
              <button
                type="button"
                aria-label={t("Удалить")}
                onClick={() => void remove(limit)}
                className="absolute right-0 flex h-12 w-[43px] cursor-pointer items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
