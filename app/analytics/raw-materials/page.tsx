import type { Metadata } from "next"

import { RawMaterialsView } from "@/components/analytics/raw-materials-view"
import { getAnalyticsReport } from "@/lib/analytics-catalog"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  const report = getAnalyticsReport("raw-materials")
  return { title: `${t(report?.label ?? "raw-materials")} — Linko` }
}

export default function Page() {
  return <RawMaterialsView />
}
