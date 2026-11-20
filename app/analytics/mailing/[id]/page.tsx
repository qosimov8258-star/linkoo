import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { MailingView } from "@/components/orders/mailing-view"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Рассылка")} — Mezon` }
}

/** The opened mailing in the URL (reference: #/telegram-mailing/25). */
export default async function Page({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return <MailingView initialId={id} />
}
