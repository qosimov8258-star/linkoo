import { AgentsTrackingView } from "@/components/tracking/agents-tracking-view"
import { parseTrackingParams } from "@/components/tracking/agents-tracking-data"
import { TrackingView } from "@/components/tracking/tracking-view"
import { todayIso } from "@/lib/finance/dates"

type TrackingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// /tracking?view=agents (default): Отслеживание of the field employees; ?view=clients: the
// clients and zones on the map. The agents page state lives in the query string (date, role
// tab, search, selected agent, map layers, filters), parsed here so the server render matches.
export default async function TrackingPage({ searchParams }: TrackingPageProps) {
  const params = await searchParams
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view
  if (requestedView === "clients") return <TrackingView view="clients" />
  const today = todayIso()
  return <AgentsTrackingView initial={parseTrackingParams(params, today)} today={today} />
}
