"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

const tabs = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"]
const tabHref: Partial<Record<string, string>> = {
  "ОХВАТ": "/analytics/coverage-analysis",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/order-debts",
  "ГИБКИЙ ДАШБОРД": "/analytics/flexible-dashboard",
  "ФИЛИАЛ": "/analytics/branch-tab",
  "ПРОДАЖА": "/analytics/sales-tab",
  "KPI": "/analytics/kpi-performance",
  "БАЛАНС": "/analytics/balance-tab",
}

export function WidgetTabs() {
  const { t } = useLanguage()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("ВИДЖЕТЫ")

  return (
    <div className="flex h-[60px] items-center justify-between">
      <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
        <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
        <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
        {t("Виджеты")}
      </h1>

      <div className="flex items-center">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              const href = tabHref[tab]
              if (href) router.push(href)
              else setActiveTab(tab)
            }}
            className={`h-8 min-w-[70px] whitespace-nowrap rounded-[5px] px-4 text-[13px] font-normal uppercase ${
              tab === activeTab
                ? "bg-[#2bcd53] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
                : "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"
            }`}
          >
            {t(tab)}
          </button>
        ))}
      </div>
    </div>
  )
}
