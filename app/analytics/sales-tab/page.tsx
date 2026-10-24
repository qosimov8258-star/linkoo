import type { Metadata } from "next"
import { Suspense } from "react"

import { SalesTabView } from "@/components/analytics/sales-tab-view"

export const metadata: Metadata = {
  title: "Продажа — Linko",
  description: "Продажи по территории, пользователям и типу продукта.",
}

export default function SalesTabPage() {
  return (
    <Suspense fallback={null}>
      <SalesTabView />
    </Suspense>
  )
}
