import type { Metadata } from "next"

import { OrderDebtsView } from "@/components/analytics/order-debts-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Долги с заказов")} — Linko`,
    description: t("Долги клиентов по заказам с разбивкой по срокам просрочки."),
  }
}

// Same report as /analytics/order-debts (live order debts by overdue bucket);
// this address is kept for old links and the "Долги с заказов" catalog entry.
export default function ClientDebtsPage() {
  return <OrderDebtsView />
}
