import type { Metadata } from "next"

import { BalanceTabView } from "@/components/analytics/balance-tab-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Баланс")} — Linko`,
    description: t("Общий финансовый баланс: склад, касса, долги клиентов и поставщиков."),
  }
}

export default function BalanceTabPage() {
  return <BalanceTabView />
}
