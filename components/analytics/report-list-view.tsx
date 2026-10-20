"use client"
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { CHECKBOX } from "./visit-builder-view"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/lib/i18n/language-context"
const categories = ["Отчеты по визитам", "Отчеты по персоналу", "Отчеты по мерчандайзингу", "Отчеты по продажам", "Отчеты по складам", "Отчеты по филиалам", "Отчеты по финансам", "", "Задачи", "Заказ и возврат по дате реализации", "Взаиморасчеты с клиентами по дате реализации"]
const reports = [
  ["Визиты по дням", "Визиты по дням", "Отчеты по визитам", "/analytics/visits-by-day"], ["Время работы агента", "Визиты агента", "Отчеты по персоналу", "/analytics/agent-working-time"], ["Store check по вопросам", "Store check по вопросам", "Отчеты по мерчандайзингу", "/analytics/general"], ["ABC анализ", "Визиты по дням", "Отчеты по продажам", "/analytics/abc-analysis"], ["Продажа по типу продуктов", "Тип", "Отчеты по продажам", "/analytics/product-type-profit"], ["Тип продуктов отгрузка", "Тип", "Отчеты по продажам", "/analytics/general"], ["Возврат по дням", "Тип", "Отчеты по продажам", "/analytics/general"], ["Визиты агента", "Визиты агента", "Отчеты по визитам", "/analytics/agent-visits"], ["Системная дистрибуция", "Системная дистрибуция", "Отчеты по визитам", "/analytics/system-distribution"], ["Визиты агентов по супервайзерам", "Визиты агентов по супервайзерам", "Отчеты по визитам", "/analytics/general"], ["Визиты агента по филиалам по дням", "Визиты агента по филиалам по дням", "Отчеты по визитам", "/analytics/general"], ["Выполнение Store Check", "Выполнение Store Check", "Отчеты по мерчандайзингу", "/analytics/general"], ["Визиты магазинам", "Визиты магазинам", "Отчеты по визитам", "/analytics/general"], ["Анализ цен", "Анализ цен", "Отчеты по мерчандайзингу", "/analytics/general"], ["Store check по продуктам", "Store check по продуктам", "Отчеты по мерчандайзингу", "/analytics/general"], ["Визиты агента за период", "Визиты агента за период", "Отчеты по визитам", "/analytics/general"], ["Доставщики", "Доставщики", "Отчеты по визитам", "/analytics/general"], ["Продажа и оплата по магазинам", "Продажа и оплата по магазинам", "Отчеты по продажам", "/analytics/client-sales-payments"], ["Продажа по родительским типами продуктов", "Родительским типам", "Отчеты по продажам", "/analytics/general"], ["Рекомендованный заказ филиалу", "Рекомендованный заказ филиалу", "Отчеты по складам", "/analytics/general"], ["Категория продажа", "Категория продажа", "Отчеты по продажам", "/analytics/general"], ["Категория АКБ", "Категория АКБ", "Отчеты по продажам", "/analytics/general"], ["Результативный визит План/Факт", "Результативный визит План/Факт", "Отчеты по визитам", "/analytics/general"], ["Средний Чек в формате план/факт", "Категория продажа", "Отчеты по продажам", "/analytics/general"], ["Динамика продаж по месяцам", "Динамика продаж по месяцам", "Отчеты по продажам", "/analytics/general"], ["Остаток с прибылью", "Остаток с прибылью", "Отчеты по складам", "/analytics/general"], ["КПИ филиалов по весу", "КПИ филиалов по весу", "Отчеты по филиалам", "/analytics/general"], ["Время нахождения в магазинах", "Время нахождения в магазинах", "Отчеты по визитам", "/analytics/store-time"], ["Задачи", "Задачи", "Задачи", "/analytics/general"], ["Отчет по наценке товара", "Отчет по наценке товара", "Отчеты по складам", "/analytics/general"], ["Прибыль от товаров", "Прибыль от товаров", "Отчеты по финансам", "/analytics/product-profit"], ["Прибыль от агентов", "Прибыль от агентов", "Отчеты по персоналу", "/analytics/agent-profit"], ["Результаты КПИ", "", "Отчеты по персоналу", "/analytics/general"], ["Посещаемость", "", "Отчеты по персоналу", "/analytics/general"], ["Классификация клиентов", "", "Отчеты по продажам", "/analytics/general"], ["Склад списание по дням", "Склад списание по дням", "", "/analytics/general"], ["Посещение ТТ по ТП", "Посещение ТТ по ТП", "Задачи", "/analytics/general"], ["Склад приход по дням", "Склад приход по дням", "", "/analytics/general"]
] as const
// (The reference tenant's own custom reports are not part of this app.)
export function ReportListView() {
  const router = useRouter()
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [authors, setAuthors] = useState<string[]>([])
  const rows = useMemo(
    () =>
      reports
        .map(([label, description, category, href], index) => ({ label, description, category, href, author: index > 30 ? "Система (Линк)" : "Система" }))
        .filter(({ label, category, author }) => (!query || label.toLowerCase().includes(query.toLowerCase())) && (!selected.length || selected.includes(category)) && (!authors.length || authors.includes(author))),
    [query, selected, authors],
  )
  const toggle = (item: string, list: string[], set: (value: string[]) => void) => set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
  const box = (item: string, list: string[], set: (value: string[]) => void) => (
    <label key={item || "empty"} className="mb-[12px] flex min-h-[22px] cursor-pointer items-start gap-[10px] text-[13px] font-medium leading-[18px]">
      <input type="checkbox" checked={list.includes(item)} onChange={() => toggle(item, list, set)} className={CHECKBOX} />
      {t(item)}
    </label>
  )

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Отчеты")} /></div>
      <div className="grid gap-[17px] px-[30px] pb-8 lg:grid-cols-[311px_1fr]">
        <aside className="self-start rounded-[8px] bg-white px-[10px] pb-[20px] pt-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <h2 className="mb-[12px] text-[13px] font-bold">{t("Категория")}</h2>
          <div className="pl-[15px]">{categories.map((item) => box(item, selected, setSelected))}</div>
          <h2 className="mb-[12px] mt-[24px] text-[13px] font-bold">{t("Автор")}</h2>
          <div className="pl-[15px]">{["Система", "Система (Линк)"].map((item) => box(item, authors, setAuthors))}</div>
        </aside>
        <section>
          <label className="relative mb-[10px] block">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Поиск отчетов...")} className="h-[42px] w-full rounded-[8px] bg-white px-[10px] pr-12 text-[13px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] outline-none placeholder:text-[#999]" />
            <Search className="absolute right-4 top-[9px] h-6 w-6 text-[#999]" />
          </label>
          <div className="overflow-hidden rounded-[3px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#f7f7f7] text-left text-[#555]"><tr>{["Название", "Описание", "Категория", "Автор"].map((head) => <th key={head} className="px-[10px] py-[8px] font-semibold">{t(head)}</th>)}</tr></thead>
              <tbody>
                {rows.map(({ label, description, category, href, author }) => (
                  <tr key={label} className="h-[37px] border-t border-[#eee] font-semibold text-[#555]">
                    <td className="px-[10px]"><button onClick={() => router.push(href)} className="text-left hover:text-[#4f71dc]">{t(label)}</button></td>
                    <td className="px-[10px]">{t(description)}</td>
                    <td className="px-[10px]">{category && <span className="rounded-full bg-[#e0e0e0] px-[8px] py-[2px] text-[12px]">{t(category)}</span>}</td>
                    <td className="px-[10px]">{t(author)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ReportPage>
  )
}
