import type { Metadata } from "next"

import { BranchTabView } from "@/components/analytics/branch-tab-view"

export const metadata: Metadata = {
  title: "Филиал — Linko",
  description: "Баланс, склад и остатки по филиалам.",
}

export default function BranchTabPage() {
  return <BranchTabView />
}
