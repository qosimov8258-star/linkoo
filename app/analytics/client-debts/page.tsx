import type { Metadata } from "next"

import { ClientDebtsView } from "@/components/analytics/client-debts-view"

export const metadata: Metadata = {
  title: "Долги с заказов — Linko",
  description: "Долги клиентов по заказам с разбивкой по срокам просрочки.",
}

export default function ClientDebtsPage() {
  return <ClientDebtsView />
}
