"use client"

import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"

// «Долг клиентов» widget tab: in the reference it only shows the user card until debt widgets are configured.
export function DebtsTabView() {
  return (
    <ReportPage>
      <WidgetHeader active="ДОЛГ КЛИЕНТОВ" />
      <WidgetUserCard showPeriods={false} />
    </ReportPage>
  )
}
