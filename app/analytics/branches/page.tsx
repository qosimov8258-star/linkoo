import { BranchesView } from "@/components/analytics/branches-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <BranchesView />
    </CatalogPageLayout>
  )
}
