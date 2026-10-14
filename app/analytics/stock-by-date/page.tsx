import type { Metadata } from "next"

import { StockMoveView } from "@/components/analytics/stock-move-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Остаток на определенную дату")} — Linko` }
}

export default function Page() {
  return <StockMoveView />
}
