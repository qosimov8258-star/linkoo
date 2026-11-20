"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { RestrictionDetail, RestrictionTab } from "@/lib/product-restrictions-types"

import { apiErrorText, SET_LIST_HINT, TAB_COPY, type ApiErrorBody } from "./product-restrictions-shared"

// The inline detail of one employee (demo #/user_product/<id>), laid out like Linko's: name bar (a click
// returns to the list) with the pencil "Изменение", the fixed rule text on the left and the employee's
// products or product types (by tab) on the right — only the header row when the list is empty.

export function RestrictionDetailPanel({
  employeeId,
  tab,
  reloadKey,
  canManage,
  onBack,
  onEdit,
}: {
  employeeId: number
  tab: RestrictionTab
  reloadKey: number
  canManage: boolean
  onBack: () => void
  onEdit: (detail: RestrictionDetail) => void
}) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<RestrictionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/product-restrictions/${employeeId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (RestrictionDetail & ApiErrorBody) | null
        if (controller.signal.aborted) return
        if (!response.ok || !body) throw new Error(apiErrorText(body, "Не удалось загрузить данные", t))
        setDetail(body)
        setError("")
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setDetail(null)
        setError(reason instanceof Error && reason.message ? reason.message : t("Не удалось загрузить данные"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [employeeId, reloadKey, t])

  const copy = TAB_COPY[tab]
  const items = detail ? (tab === "product" ? detail.products : detail.productTypes) : []

  // Linko: 60 px rows with dotted separators (the first one is the 600-weight header), № in 1/12 of the row.
  const row = "relative grid h-[60px] grid-cols-[1fr_11fr] items-center pl-[5px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

  return (
    <div className="bg-white">
      <div className="flex h-[65px] items-center justify-between gap-3 border-b border-[#efefef] px-4 sm:px-[30px]">
        <button type="button" onClick={onBack} className="min-w-0 flex-1 truncate text-left text-[18px] font-semibold text-[#333]">
          {detail?.name || (loading ? "" : `#${employeeId}`)}
          {detail && !detail.active && <span className="ml-3 align-middle text-[12px] font-normal text-[#9e9e9e]">{t("Неактивный")}</span>}
        </button>
        {canManage && detail && (
          <button
            type="button"
            onClick={() => onEdit(detail)}
            title={t(SET_LIST_HINT)}
            aria-label={t(SET_LIST_HINT)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>
        )}
      </div>

      {loading && !detail ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[#586174]">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      ) : error ? (
        <p className="px-4 py-10 text-center text-[#e53935] sm:px-[30px]">{error}</p>
      ) : (
        <div className="flex flex-col py-5 text-[#333] md:flex-row">
          <div className="border-b border-[#efefef] px-4 pb-5 text-[14px] font-semibold sm:px-[30px] md:max-h-[585px] md:w-[340px] md:shrink-0 md:border-b-0 md:border-r md:pb-0">
            {t("Агент только будет продавать товары в этом списке")}
          </div>
          <div className="min-w-0 flex-1 px-4 pb-5 sm:px-[30px]">
            <div className="max-h-[500px] overflow-y-auto overflow-x-hidden sm:pr-[30px]">
              <div className={`${row} font-semibold`}>
                <span>№</span>
                <span className="pl-2">{t(copy.item)}</span>
              </div>
              {items.map((item, index) => (
                <div key={item.id} className={`${row} hover:bg-[#f2f5f8]`}>
                  <span>{index + 1}</span>
                  <span className="break-words pl-2">
                    {item.name}
                    {item.deleted && <span className="ml-2 rounded-[3px] bg-[#ffebee] px-[6px] py-[1px] text-[11px] text-[#c62828]">{t("Удален")}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
