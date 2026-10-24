import { EquipmentView } from "@/components/analytics/equipment-view"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"

export default function Page() {
  return (
    <CatalogPageLayout>
      <EquipmentView />
    </CatalogPageLayout>
  )
}
