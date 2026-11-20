import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { AmountPrecisionView } from "@/components/settings/amount-precision-view"

export default function SettingsAmountPrecisionPage() {
  return (
    <CatalogPageLayout>
      <AmountPrecisionView />
    </CatalogPageLayout>
  )
}
