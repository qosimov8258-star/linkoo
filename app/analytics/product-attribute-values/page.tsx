import { ProductAttributeValuesView } from "@/components/analytics/product-attribute-values-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <ProductAttributeValuesView />
    </CatalogPageLayout>
  )
}
