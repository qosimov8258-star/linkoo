import type { Metadata } from "next"

import { FlexibleDashboardView } from "@/components/analytics/flexible-dashboard-view"

export const metadata: Metadata = {
  title: "Гибкий дашборд — Linko",
  description: "Настраиваемый дашборд с произвольным набором виджетов.",
}

export default function FlexibleDashboardPage() {
  return <FlexibleDashboardView />
}
