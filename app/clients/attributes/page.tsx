import { AttributesView } from "@/components/clients/attributes-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function AttributesPage() {
  return (
    <CatalogPageLayout>
      <AttributesView embedded />
    </CatalogPageLayout>
  )
}
