import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ClientModuleView } from "@/components/clients/client-module-view"
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content"
import { clientModules, getClientModule } from "@/lib/clients-catalog"
import { getServerT } from "@/lib/i18n/server"

type ClientModulePageProps = {
  params: Promise<{ slug: string }>
}

// Only the catalog's modules exist: where Next enforces dynamicParams (next dev), any other
// /clients/<slug> is an unmatched URL and the router answers with the localized app/not-found.tsx
// (404). A production build does not enforce it for this route (the root layout reads cookies, so
// it is never prerendered), so the page also renders the same localized screen itself for an
// unknown slug: a notFound() thrown during the render would give only Next's bare error shell.
// /clients/clients (the list itself) redirects to /clients.
export const dynamicParams = false

export function generateStaticParams() {
  return clientModules.map((clientModule) => ({ slug: clientModule.slug }))
}

export async function generateMetadata({ params }: ClientModulePageProps): Promise<Metadata> {
  const { slug } = await params
  const clientModule = getClientModule(slug)
  const t = await getServerT()

  if (!clientModule) return notFoundMetadata()

  return {
    title: `${t(clientModule.label)} — Linko`,
    description: t(clientModule.description),
  }
}

export default async function ClientModulePage({ params }: ClientModulePageProps) {
  const { slug } = await params
  const clientModule = getClientModule(slug)

  if (clientModule?.slug === "clients") redirect("/clients")
  if (!clientModule) return <NotFoundContent />

  return <ClientModuleView clientModule={clientModule} />
}
