import { Suspense } from "react"
import { WidgetTabs } from "@/components/dashboard/widget-tabs"
import { DashboardContent } from "@/components/dashboard/dashboard-content"

export default function Page() {
  return (
    <main>
      <WidgetTabs />
      <Suspense fallback={null}>
        <DashboardContent />
      </Suspense>
    </main>
  )
}
