"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

const tabs = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"]
const tabHref: Partial<Record<string, string>> = {
  "ОХВАТ": "/analytics/coverage-analysis",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/client-debts",
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
    <div className="flex items-center gap-6 px-6 pt-4">
      <div className="flex items-center gap-4">
        <FavoritesButton className="flex items-center gap-2 text-lg font-bold text-link" />
        <span className="text-slate-300">|</span>
        <span className="text-lg font-bold text-slate-700">{t("Виджеты")}</span>
      </div>

      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => { const href = tabHref[tab]; if (href) router.push(href); else setActiveTab(tab) }}
            className={`whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-bold transition-colors ${
              tab === activeTab
                ? "bg-brand-green text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t(tab)}
          </button>
        ))}
      </div>
    </div>
  )
}
