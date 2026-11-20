"use client"

import { useEffect, useState } from "react"

import { dayText } from "@/components/analytics/inventory-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import type { InventoryItemListResult } from "@/lib/inventory-items-types"

import { DOTTED_ROW } from "./shop-drawer-logs"

// КЛИЕНТ → ДЕТАЛИ of the shop drawer, after «Класс клиента»: the equipment attached to the shop (Linko's
// market/market/<id>/?detail_gear=true → extra_message.gears): a «№ Товар | Дата» header and one dotted line per item,
// newest first. Nothing shows while the shop has none (or the list cannot be read).

type Gear = { id: number; product: string; date: string }

export function ShopDrawerGears({ clientId }: { clientId: number }) {
  const { t, language } = useLanguage()
  const [gears, setGears] = useState<Gear[]>([])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/inventory-items?status=in_market&client=${clientId}&ordering=-id&pageSize=0`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as InventoryItemListResult | null
        if (!response.ok || !Array.isArray(body?.results)) return
        setGears(body.results.map((item) => ({ id: item.id, product: item.product.name, date: item.date })))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [clientId])

  if (!gears.length) return null
  const line = `${DOTTED_ROW} -mx-[10px] flex items-center px-[10px]`
  return (
    <div className="mt-[10px]">
      <div className={`${line} min-h-[50px] font-semibold`}>
        <span className="w-2/3">
          <span className="mr-[10px]">№</span>
          {t("Товар")}
        </span>
        <span className="w-1/3">{t("Дата")}</span>
      </div>
      {gears.map((gear) => (
        <div key={gear.id} className={`${line} min-h-[60px] py-[5px]`}>
          <span className="w-2/3 min-w-0 break-words">
            <span className="mr-[10px] font-semibold">{gear.id}</span>
            {gear.product}
          </span>
          <span className="w-1/3">{dayText(gear.date, language)}</span>
        </div>
      ))}
    </div>
  )
}
