import { ClientTypesView } from "@/components/clients/client-types-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function ClientTypesPage() {
  return (
    <CatalogPageLayout>
      <ClientTypesView embedded />
    </CatalogPageLayout>
  )
}
