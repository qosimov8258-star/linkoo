import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RawMaterialsView } from "@/components/analytics/raw-materials-view"
import { getAnalyticsReport } from "@/lib/analytics-catalog"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  const report = getAnalyticsReport("raw-materials")
  return { title: `${t(report?.label ?? "raw-materials")} — Linko` }
}

/** The opened item in the URL (reference: #/product/966). */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  return <RawMaterialsView initialDetailId={id} />
}
