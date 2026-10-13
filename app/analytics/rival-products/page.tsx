import { RivalProductsView } from "@/components/analytics/rival-products-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <RivalProductsView />
    </CatalogPageLayout>
  )
}
