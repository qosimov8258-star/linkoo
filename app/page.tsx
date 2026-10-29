import { Suspense } from "react"
import { redirect } from "next/navigation"
import { WidgetTabs } from "@/components/dashboard/widget-tabs"
import { DashboardContent } from "@/components/dashboard/dashboard-content"

// The reference opens every dashboard tab as /#/?toggleTab=<tab>; here each tab
// is its own page, so a link copied from the reference lands on the same tab.
const toggleTabHref: Record<string, string> = {
  kpi: "/analytics/kpi-tab",
  balance: "/analytics/balance-tab",
  coverage: "/analytics/coverage-analysis",
  branch: "/analytics/branch-tab",
  profit: "/analytics/pnl",
  sales: "/analytics/sales-tab",
  flexible: "/analytics/flexible-dashboard",
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const toggleTab = typeof params.toggleTab === "string" ? params.toggleTab : ""
  const href = toggleTabHref[toggleTab]
  if (href) {
    const rest = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (key !== "toggleTab" && typeof value === "string") rest.set(key, value)
    }
    const query = rest.toString()
    redirect(query ? `${href}?${query}` : href)
  }

  return (
    <main className="min-h-screen bg-[#f2f5f8] px-[30px] pb-7 font-sans text-[13px] text-[#333]">
      <WidgetTabs />
      <Suspense fallback={null}>
        <DashboardContent />
      </Suspense>
    </main>
  )
}
