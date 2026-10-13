import { Suspense } from "react"
import { WidgetTabs } from "@/components/dashboard/widget-tabs"
import { DashboardContent } from "@/components/dashboard/dashboard-content"

export default function Page() {
  return (
    <main className="min-h-screen bg-[#f2f5f8] px-[30px] pb-7 font-sans text-[13px] text-[#333]">
      <WidgetTabs />
      <Suspense fallback={null}>
        <DashboardContent />
      </Suspense>
    </main>
  )
}
