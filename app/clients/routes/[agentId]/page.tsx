import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AgentRouteView } from "@/components/clients/agent-route-view"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ agentId: string }>; searchParams: Promise<{ date?: string | string[] }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Маршруты")} — Mezon` }
}

/** Анализ маршрутов → an agent (reference: #/plan/201); `?date=` keeps the day picked on another agent. */
export default async function AgentRoutePage({ params, searchParams }: PageProps) {
  const id = Number((await params).agentId)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const date = (await searchParams).date
  const day = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : undefined
  return <AgentRouteView key={id} employeeId={id} initialDate={day} />
}
