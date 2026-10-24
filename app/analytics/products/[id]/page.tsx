import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ProductsView } from "@/components/analytics/products-view"
import { getAnalyticsReport } from "@/lib/analytics-catalog"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  const report = getAnalyticsReport("products")
  return { title: `${t(report?.label ?? "products")} — Linko` }
}

/** The opened item in the URL (reference: #/product/966). */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  return <ProductsView initialDetailId={id} />
}
