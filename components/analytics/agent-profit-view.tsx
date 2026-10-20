"use client"

import { AgentProfitReportView } from "@/components/analytics/product-profit-view"

// "Прибыль от агентов": the server P&L per agent / branch / zone (see product-profit-view.tsx).
export function AgentProfitView() {
  return <AgentProfitReportView />
}
