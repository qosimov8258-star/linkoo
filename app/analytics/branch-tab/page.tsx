import type { Metadata } from "next"

import { BranchTabView } from "@/components/analytics/branch-tab-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return {
    title: `${t("Филиал")} — Linko`,
    description: t("Баланс, склад и остатки по филиалам."),
  }
}

export default function BranchTabPage() {
  return <BranchTabView />
}
