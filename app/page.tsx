import { WidgetTabs } from "@/components/dashboard/widget-tabs"
import { DateRangeBar } from "@/components/dashboard/date-range-bar"
import { StatCards } from "@/components/dashboard/stat-cards"
import { LeftPanel } from "@/components/dashboard/left-panel"
import { CenterPanel } from "@/components/dashboard/center-panel"
import { RightPanel } from "@/components/dashboard/right-panel"

export default function Page() {
  return (
    <main>
      <WidgetTabs />
      <DateRangeBar />
      <StatCards />

      <div className="grid grid-cols-1 gap-6 px-3 py-4 sm:px-6 sm:py-6 xl:grid-cols-3">
        <LeftPanel />
        <CenterPanel />
        <RightPanel />
      </div>
    </main>
  )
}
