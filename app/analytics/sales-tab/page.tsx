import type { Metadata } from "next"
import { Suspense } from "react"

import { SalesTabView } from "@/components/analytics/sales-tab-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Продажа")} — Linko`,
    description: t("Продажи по территории, пользователям и типу продукта."),
  }
}

export default function SalesTabPage() {
  return (
    <Suspense fallback={null}>
      <SalesTabView />
    </Suspense>
  )
}
