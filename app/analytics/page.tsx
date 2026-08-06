import { redirect } from "next/navigation"

export default function AnalyticsIndexPage() {
  redirect("/analytics/visits-by-day")
}
