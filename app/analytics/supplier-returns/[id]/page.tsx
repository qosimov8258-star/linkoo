import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { SupplierReturnsView } from "@/components/analytics/supplier-returns-view"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Возврат поставщиков")} — Mezon` }
}

/** The opened supplier return in the URL (Linko: #/provider-return/22?<list query>). */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return <SupplierReturnsView initialId={id} />
}
