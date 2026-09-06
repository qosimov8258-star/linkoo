import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  LayoutGrid,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react"

import type { AnalyticsReport, AnalyticsResource } from "@/lib/analytics-catalog"
import type { LucideIcon } from "lucide-react"

const resourceIcons: Record<string, LucideIcon> = {
  sales: ShoppingCart,
  "warehouse-logistics": Truck,
  "finance-cash": Wallet,
  general: LayoutGrid,
}

const groupLabels: Record<AnalyticsReport["group"], string> = {
  visits: "Контроль визитов",
  sales: "Контроль продаж",
  tools: "Дополнительные инструменты",
}

export function AnalyticsSectionView({
  resource,
  reports,
}: {
  resource: AnalyticsResource
  reports: AnalyticsReport[]
}) {
  const ResourceIcon = resourceIcons[resource.slug] ?? LayoutGrid
  const metrics = [
    { label: "Активные отчёты", value: reports.length, icon: BarChart3, color: "bg-blue-50 text-brand-blue" },
    { label: "Обработано записей", value: "0", icon: Boxes, color: "bg-violet-50 text-violet-600" },
    { label: "Выполнение плана", value: "0%", icon: ClipboardCheck, color: "bg-emerald-50 text-brand-green" },
    { label: "Динамика за месяц", value: "0%", icon: CircleDollarSign, color: "bg-orange-50 text-brand-orange" },
  ]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <Link
          href="/"
          className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue transition-colors hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <section className="mb-6 overflow-hidden rounded-xl bg-navy text-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <ResourceIcon className="h-8 w-8 text-brand-sky" strokeWidth={1.8} />
            </span>
            <div>
              <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-brand-sky">Resources</p>
              <h1 className="text-2xl font-bold sm:text-3xl">{resource.title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">{resource.description}</p>
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon, color }) => (
            <article key={label} className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${color}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm text-slate-400">{label}</span>
                <strong className="text-xl text-slate-800">{value}</strong>
              </span>
            </article>
          ))}
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-800">Доступные отчёты</h2>
            <p className="mt-1 text-sm text-slate-500">Выберите отчёт для просмотра показателей и детализации.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <Link
                key={report.slug}
                href={report.href}
                className="group flex min-h-40 flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-blue/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
              >
                <span className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-blue">{groupLabels[report.group]}</span>
                <strong className="text-base text-slate-800 transition-colors group-hover:text-brand-blue">{report.label}</strong>
                <span className="mt-2 flex-1 text-sm leading-6 text-slate-500">{report.description}</span>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue">
                  Открыть отчёт
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
