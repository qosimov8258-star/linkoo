import { ProductAttributesView } from "@/components/analytics/product-attributes-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <ProductAttributesView />
    </CatalogPageLayout>
  )
}
