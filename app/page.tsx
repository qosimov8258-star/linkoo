import { Suspense } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { WidgetTabs } from "@/components/dashboard/widget-tabs"
import { DashboardContent } from "@/components/dashboard/dashboard-content"
import { HOME_PAGE } from "@/lib/home-page"

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
  // Entering the site at its bare address (typed, a bookmark, a link from elsewhere: the browser's
  // Sec-Fetch-Site is not "same-origin") opens the home page (lib/home-page.ts). Links inside the
  // app that lead to "/" (a starred «Виджеты», «На главную», a branch switch) still open the
  // dashboard, which also writes its own beginDate/endDate into the address.
  if (Object.keys(params).length === 0 && (await headers()).get("sec-fetch-site") !== "same-origin") redirect(HOME_PAGE)
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
