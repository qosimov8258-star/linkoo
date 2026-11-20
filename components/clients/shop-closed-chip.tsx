"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Linko's red «Закрыто» chip in the shop drawer's header (market.is_closed): 40 px high, a white warning sign and the
// word, before the pencil. Nothing is shown for an open shop or while the mark loads.
export function ShopClosedChip({ clientId }: { clientId: number }) {
  const { t } = useLanguage()
  const [closed, setClosed] = useState<{ id: number; value: boolean } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/clients/${clientId}/closed`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ closed?: boolean }>) : null))
      .then((body) => setClosed({ id: clientId, value: body?.closed === true }))
      .catch(() => {})
    return () => controller.abort()
  }, [clientId])

  if (!closed || closed.id !== clientId || !closed.value) return null
  return (
    <span className="flex h-10 w-max items-center gap-[5px] rounded-[4px] bg-[#FF5E5E] px-[10px] py-[5px] text-[13px] font-semibold uppercase text-white">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
      {t("Закрыто")}
    </span>
  )
}
