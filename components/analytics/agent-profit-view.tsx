"use client"

import { ProfitReportView } from "@/components/analytics/profit-report-view"

export function AgentProfitView() {
  return <ProfitReportView title="Прибыль от агентов" entity="Агент" source="agents" realizedLabel="ПРОДАЖА АГЕНТОВ ПО ДАТЕ РЕАЛИЗАЦИИ С ПРИБЫЛЬЮ" fileName="agent-profit.xls" />
}
