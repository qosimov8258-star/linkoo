"use client"

import { Loader2, Pencil } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { RestrictionDetail, RestrictionTab } from "@/lib/product-restrictions-types"

import { apiErrorText, SET_LIST_HINT, TAB_COPY, type ApiErrorBody } from "./product-restrictions-shared"

// The inline detail of one employee (demo #/user_product/<id>): name bar (a click returns to the
// list) with the pencil "Изменение", the fixed rule text on the left and the employee's products
// or product types (by tab) on the right.

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

  return (
    <div className="bg-white">
      <div className="flex h-[65px] items-center justify-between gap-3 border-b border-[#e8ebf0] px-4 sm:px-[30px]">
        <button type="button" onClick={onBack} className="min-w-0 flex-1 truncate text-left text-[18px] font-semibold text-[#333] hover:text-[#4f71dc]">
          {detail?.name || (loading ? "" : `#${employeeId}`)}
          {detail && !detail.active && <span className="ml-3 align-middle text-[12px] font-normal text-[#9e9e9e]">{t("Неактивный")}</span>}
        </button>
        {canManage && detail && (
          <button
            type="button"
            onClick={() => onEdit(detail)}
            title={t(SET_LIST_HINT)}
            aria-label={t(SET_LIST_HINT)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5d6474] hover:bg-[#f2f5f8]"
          >
            <Pencil className="h-5 w-5" />
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
        <div className="flex flex-col md:flex-row">
          <div className="border-b border-[#e8ebf0] px-4 py-5 text-[14px] font-semibold sm:px-[30px] md:w-[340px] md:shrink-0 md:border-b-0 md:border-r">
            {t("Агент только будет продавать товары в этом списке")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="grid h-[44px] grid-cols-[56px_minmax(0,1fr)] items-center border-b border-[#e8ebf0] px-4 font-bold sm:px-[30px]">
              <span>№</span>
              <span>{t(copy.item)}</span>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-[#9e9e9e] sm:px-[30px]">{t("Не установлено")}</p>
              ) : (
                items.map((item, index) => (
                  <div key={item.id} className="grid min-h-[40px] grid-cols-[56px_minmax(0,1fr)] items-center border-b border-dashed border-[#eef0f4] px-4 hover:bg-[#f2f5f8] sm:px-[30px]">
                    <span>{index + 1}</span>
                    <span className="break-words py-2">
                      {item.name}
                      {item.deleted && <span className="ml-2 rounded-[3px] bg-[#ffebee] px-[6px] py-[1px] text-[11px] text-[#c62828]">{t("Удален")}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
