import type { Metadata } from "next"

import { PnLView } from "@/components/analytics/pnl-view"

export const metadata: Metadata = {
  title: "P&L — Linko",
  description: "Отчёт о прибылях и убытках: реализация, возвраты, валовая прибыль и рентабельность.",
}

export default function PnLPage() {
  return <PnLView />
}
