import { AttributesView } from "@/components/clients/attributes-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

// A settings page (Настройки → Клиенты → Атрибуты): same layout as the sibling client-types page.
export default function AttributesPage() {
  return (
    <CatalogPageLayout sidebarWidth={196}>
      <AttributesView embedded />
    </CatalogPageLayout>
  )
}
