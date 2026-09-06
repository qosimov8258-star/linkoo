import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ClientModuleView } from "@/components/clients/client-module-view"
import { clientModules, getClientModule } from "@/lib/clients-catalog"
import { getServerT } from "@/lib/i18n/server"

type ClientModulePageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return clientModules
    .filter((clientModule) => clientModule.slug !== "clients")
    .map((clientModule) => ({ slug: clientModule.slug }))
}

export async function generateMetadata({ params }: ClientModulePageProps): Promise<Metadata> {
  const { slug } = await params
  const clientModule = getClientModule(slug)
  const t = await getServerT()

  if (!clientModule || clientModule.slug === "clients") {
    return { title: `${t("Раздел не найден")} — Linko` }
  }

  return {
    title: `${t(clientModule.label)} — Linko`,
    description: t(clientModule.description),
  }
}

export default async function ClientModulePage({ params }: ClientModulePageProps) {
  const { slug } = await params
  const clientModule = getClientModule(slug)

  if (!clientModule || clientModule.slug === "clients") notFound()

  return <ClientModuleView clientModule={clientModule} />
}
