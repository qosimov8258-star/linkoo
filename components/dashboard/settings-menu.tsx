"use client"

import Link from "next/link"
import { ChevronRight, Lightbulb, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"

// href is omitted for items that don't have a real page anywhere in the
// app yet — they render as plain (non-clickable) text instead of a dead
// link, so the menu can show the full intended structure without ever
// producing a 404.
type SettingsLink = { label: string; href?: string }
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
      { label: "Бренд", href: "/analytics/brands" },
      { label: "Атрибуты", href: "/analytics/product-attributes" },
      { label: "Значение атрибута", href: "/analytics/product-attribute-values" },
      { label: "Продукты конкурентов", href: "/analytics/rival-products" },
    ],
  },
  {
    title: "Клиенты",
    items: [
      { label: "Типы клиентов", href: "/clients/client-types" },
      { label: "Атрибуты", href: "/clients/attributes" },
      { label: "Значение атрибута", href: "/clients/attribute-values" },
      { label: "Категория магазина", href: "/analytics/store-categories" },
    ],
  },
  {
    title: "Конструкторы",
    items: [
      { label: "Конструктор документов" },
      { label: "Дашборды", href: "/analytics/dashboard-settings" },
      { label: "Настройка EXCEL заказов" },
    ],
  },
  {
    title: "Поставщики",
    items: [{ label: "Категории поставщиков", href: "/analytics/supplier-categories" }],
  },
  {
    title: "Склад",
    items: [
      { label: "Склады", href: "/analytics/warehouses" },
      { label: "Настройка чека" },
      { label: "Тип ячейки" },
      { label: "Ячейки" },
    ],
  },
  {
    title: "Разное",
    items: [
      { label: "Прайс-листы", href: "/analytics/price-lists" },
      { label: "Тип отказа", href: "/analytics/refusal-types" },
      { label: "Филиалы", href: "/analytics/branches" },
      { label: "Оборудования" },
      { label: "Организация", href: "/analytics/organization" },
      { label: "Объединение", href: "/analytics/duplicate-analysis" },
      { label: "Ограничение времени", href: "/analytics/time-restrictions" },
      { label: "Закрытия дня/месяца" },
      { label: "Интеграция", href: "/settings/integrations" },
      { label: "Уведомления", href: "/settings/notifications" },
    ],
  },
]

const languages: { code: LanguageCode; label: string }[] = [
  { code: "ru", label: "RU" },
  { code: "uz", label: "UZ" },
  { code: "tk", label: "TK" },
  { code: "en", label: "EN" },
]

interface SettingsMenuProps {
  onClose: () => void
}

export function SettingsMenu({ onClose }: SettingsMenuProps) {
  const { language, setLanguage, t } = useLanguage()

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[1200] bg-black/[0.54]" />
      <div className="fixed right-0 top-0 z-[1300] flex h-full w-[340px] max-w-full flex-col bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="flex items-start justify-between border-b border-[#efefef] px-[30px] py-[15px]">
          <div>
            <h2 className="text-[15px] font-semibold leading-5 text-black">{t("Настройки")}</h2>
            <p className="text-[13px] text-[#333]">{t("Версия")}: 7.1.59 (API: 147)</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="mt-1 text-[#333]">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="px-[30px] pb-[10px] pt-[10px] text-center">
          <a href="tel:+998785555525" className="text-[15px] font-semibold text-[#0a9ddb] hover:underline">
            {t("Онлайн техподдержка")}
          </a>
          <p className="text-[20px] font-bold leading-7 text-[#333]">+998 78 555-55-25</p>
        </div>

        <div className="flex border-b border-[#efefef] px-[25px] pb-[14px]">
          {languages.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              className={`h-[30px] flex-1 border text-[13px] font-semibold ${
                language === code ? "border-[#38c172] bg-[#38c172] text-white" : "border-[#e0e0e0] bg-white text-[#333] hover:bg-[#f5f5f5]"
              } rounded-[3px]`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="border-b border-[#efefef] px-[15px] py-[10px]">
          <Link
            href="/analytics/knowledge-base"
            onClick={onClose}
            className="flex h-[50px] items-center gap-3 rounded-[10px] bg-gradient-to-r from-[#4658f2] to-[#5a6cf5] px-[14px] text-[18px] font-semibold text-white hover:opacity-90"
          >
            <Lightbulb className="h-7 w-7 shrink-0 text-amber-300" />
            <span className="flex-1">{t("База знаний")}</span>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[30px] py-[15px]">
          {sections.map((section, index) => (
            <div key={section.title} className={index > 0 ? "mt-[22px]" : ""}>
              <h3 className="text-[13px] font-bold text-black">{t(section.title)}</h3>
              <ul className="mt-[8px] pl-[20px]">
                {section.items.map((item) =>
                  item.href ? (
                    <li key={item.label}>
                      <Link href={item.href} onClick={onClose} className="block py-[6.5px] text-[13px] text-[#333] hover:text-[#4f71dc]">
                        {t(item.label)}
                      </Link>
                    </li>
                  ) : (
                    <li key={item.label}>
                      <span className="block cursor-not-allowed py-[6.5px] text-[13px] text-[#999]" title={t("Скоро будет доступно")}>
                        {t(item.label)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
