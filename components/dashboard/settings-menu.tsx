"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronRight, Lightbulb, X } from "lucide-react"

type SettingsLink = { label: string; href: string }
type SettingsSection = { title: string; items: SettingsLink[] }

const sections: SettingsSection[] = [
  {
    title: "Персонал",
    items: [
      { label: "Подписки", href: "/analytics/subscriptions" },
      { label: "Сотрудники", href: "/analytics/employees" },
      { label: "Смены", href: "/analytics/shifts" },
      { label: "Должности", href: "/analytics/positions" },
      { label: "Права доступа", href: "/analytics/access-rights" },
      { label: "Транспорт", href: "/analytics/transport" },
      { label: "Сессия", href: "/analytics/sessions" },
    ],
  },
  {
    title: "Финансы",
    items: [
      { label: "Валюты", href: "/analytics/currencies" },
      { label: "Кассы", href: "/analytics/cashboxes" },
      { label: "Категории приходов", href: "/analytics/income-categories" },
      { label: "Категории расходов", href: "/analytics/expense-categories" },
    ],
  },
  {
    title: "Продукты",
    items: [
      { label: "Типы продуктов", href: "/analytics/product-types" },
      { label: "Измерения", href: "/analytics/units-of-measure" },
    ],
  },
]

const languages = ["RU", "UZ", "TK", "EN"] as const

interface SettingsMenuProps {
  onClose: () => void
}

export function SettingsMenu({ onClose }: SettingsMenuProps) {
  const [language, setLanguage] = useState<(typeof languages)[number]>("RU")

  return (
    <div className="absolute right-0 top-full z-50 w-[340px] max-w-[92vw] overflow-hidden rounded-b-md bg-white text-foreground shadow-2xl">
      <div className="flex items-start justify-between px-6 py-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Настройки</h2>
          <p className="mt-1 text-[13px] text-slate-500">Версия: 7.1.58 (API: 147)</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="text-slate-500 hover:text-slate-900">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="border-t border-slate-100 px-6 py-5 text-center">
        <a href="tel:+998785555525" className="text-[15px] font-semibold text-brand-blue hover:underline">
          Онлайн техподдержка
        </a>
        <p className="mt-1 text-lg font-bold text-slate-900">+998 78 555-55-25</p>
      </div>

      <div className="flex gap-2 border-t border-slate-100 px-6 py-4">
        {languages.map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => setLanguage(lang)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
              language === lang
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {lang}
          </button>
        ))}
      </div>

      <div className="border-t border-slate-100 px-6 py-4">
        <Link
          href="/analytics/knowledge-base"
          onClick={onClose}
          className="flex items-center gap-3 rounded-md bg-gradient-to-r from-[#5c6df3] to-[#7b6cf6] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Lightbulb className="h-5 w-5 shrink-0 text-amber-300" />
          <span className="flex-1">База знаний</span>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </Link>
      </div>

      <div className="max-h-[420px] overflow-y-auto border-t border-slate-100 px-6 py-4">
        {sections.map((section, index) => (
          <div key={section.title} className={index > 0 ? "mt-5" : ""}>
            <h3 className="text-[15px] font-bold text-slate-900">{section.title}</h3>
            <ul className="mt-2">
              {section.items.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className="block py-2 text-[15px] text-slate-600 transition-colors hover:text-brand-blue"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
