import type { Metadata } from "next"

import { ProductTypeProfitView } from "@/components/analytics/product-type-profit-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Прибыль по типам продуктов")} — Linko` }
}

export default function ProductTypeProfitPage() {
  return <ProductTypeProfitView />
}
