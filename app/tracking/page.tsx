import { TrackingView } from "@/components/tracking/tracking-view"

type TrackingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TrackingPage({ searchParams }: TrackingPageProps) {
  const params = await searchParams
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view
  const view = requestedView === "clients" ? "clients" : "agents"

  return <TrackingView view={view} />
}
