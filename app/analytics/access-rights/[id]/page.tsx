import { notFound } from "next/navigation"

import { AccessRightsView } from "@/components/analytics/access-rights-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

/** An access right whose dialog is open (reference: #/position/100?openUpdateDialog=true); the list is /analytics/access-rights. */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return (
    <CatalogPageLayout>
      <AccessRightsView embedded initialId={id} />
    </CatalogPageLayout>
  )
}
