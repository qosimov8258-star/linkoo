import { StoreCategoriesView } from "@/components/analytics/store-categories-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <StoreCategoriesView />
    </CatalogPageLayout>
  )
}
