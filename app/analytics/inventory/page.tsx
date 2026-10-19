import type { Metadata } from "next"

import { InventoryPage } from "@/components/analytics/inventory-page"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Инвентаризация")} — Linko`,
    description: t("Инвентаризация склада: подсчёт фактических остатков, подтверждение и отмена."),
  }
}

export default function InventoryRoute() {
  return <InventoryPage />
}
