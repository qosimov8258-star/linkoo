import { AttributeValuesView } from "@/components/clients/attribute-values-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function AttributeValuesPage() {
  return (
    <CatalogPageLayout>
      <AttributeValuesView embedded />
    </CatalogPageLayout>
  )
}
