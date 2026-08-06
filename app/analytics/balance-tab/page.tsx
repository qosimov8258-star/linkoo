import type { Metadata } from "next"

import { BalanceTabView } from "@/components/analytics/balance-tab-view"

export const metadata: Metadata = {
  title: "Баланс — Linko",
  description: "Общий финансовый баланс: склад, касса, долги клиентов и поставщиков.",
}

export default function BalanceTabPage() {
  return <BalanceTabView />
}
