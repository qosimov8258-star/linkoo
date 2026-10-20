import type { Metadata } from "next"

import { FlexibleDashboardView } from "@/components/analytics/flexible-dashboard-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Гибкий дашборд")} — Linko`,
    description: t("Настраиваемый дашборд с произвольным набором виджетов."),
  }
}

export default function FlexibleDashboardPage() {
  return <FlexibleDashboardView />
}
