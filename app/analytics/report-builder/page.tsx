import type { Metadata } from "next"
import { NewReportBuilderView } from "@/components/analytics/new-report-builder-view"

export const metadata: Metadata = {
  title: "Новый конструктор отчетов — Linko",
  description: "Настраиваемый отчет с колонками, группировками, фильтрами и экспортом в Excel.",
}

export default function NewReportBuilderPage() {
  return <NewReportBuilderView />
}
