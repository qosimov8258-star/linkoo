import { Suspense } from "react"

import { RepricingView } from "@/components/analytics/repricing-view"

// Linko's #/revaluation/88/: the list with document 88 opened in place of its row.
export default function RepricingDocumentPage() {
  return (
    <Suspense>
      <RepricingView />
    </Suspense>
  )
}
