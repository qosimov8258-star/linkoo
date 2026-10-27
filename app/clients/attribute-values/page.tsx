import { AttributeValuesView } from "@/components/clients/attribute-values-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

// A settings page (Настройки → Клиенты → Значение атрибута): same layout as the sibling client-types page.
export default function AttributeValuesPage() {
  return (
    <CatalogPageLayout sidebarWidth={196}>
      <AttributeValuesView embedded />
    </CatalogPageLayout>
  )
}
