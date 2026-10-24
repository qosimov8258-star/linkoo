import type { Metadata } from "next"
import { Suspense } from "react"

import { QuickReportView } from "@/components/analytics/quick-report-view"

export const metadata: Metadata = {
  title: "Конструктор отчетов — Linko",
  description: "Быстрый отчет по выбранной модели с тремя параметрами и видами диаграмм.",
}

export default function QuickReportPage() {
  return (
    <Suspense>
      <QuickReportView />
    </Suspense>
  )
}
