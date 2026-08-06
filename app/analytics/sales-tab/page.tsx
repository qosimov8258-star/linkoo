import type { Metadata } from "next"

import { SalesTabView } from "@/components/analytics/sales-tab-view"

export const metadata: Metadata = {
  title: "Продажа — Linko",
  description: "Продажи по территории, пользователям и типу продукта.",
}

export default function SalesTabPage() {
  return <SalesTabView />
}
