import { notFound } from "next/navigation"

import { BranchesView } from "@/components/analytics/branches-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

/** The opened branch in the URL (reference: #/branch/7). */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return (
    <CatalogPageLayout>
      <BranchesView initialId={id} />
    </CatalogPageLayout>
  )
}
