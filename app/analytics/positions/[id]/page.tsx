import { notFound } from "next/navigation"

import { PositionsView } from "@/components/analytics/positions-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

/** A position whose dialog is open (reference: #/post/49?openUpdateDialog=true); the list itself is /analytics/positions. */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return (
    <CatalogPageLayout>
      <PositionsView embedded initialId={id} />
    </CatalogPageLayout>
  )
}
