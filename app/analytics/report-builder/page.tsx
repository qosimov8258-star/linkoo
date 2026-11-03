import type { Metadata } from "next"
import { NewReportBuilderView } from "@/components/analytics/new-report-builder-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Новый конструктор отчетов")} — Mezon`,
    description: t("Настраиваемый отчет с колонками, группировками, фильтрами и экспортом в Excel."),
  }
}

export default function NewReportBuilderPage() {
  return <NewReportBuilderView />
}
