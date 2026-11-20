import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { TelegramBotPagesView } from "@/components/analytics/telegram-bot-pages-view"
import { getAnalyticsReport } from "@/lib/analytics-catalog"
import { getServerT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ key: string }> }

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  const report = getAnalyticsReport("telegram-pages")
  return { title: `${t(report?.label ?? "Страницы телеграм бота")} — Mezon` }
}

/** The opened page in the URL, by Linko's id as the reference names it (#/system-pages/2), or by its key. */
export default async function Page({ params }: PageProps) {
  const key = (await params).key
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !/^[1-9]\d{0,8}$/.test(key)) notFound()
  return <TelegramBotPagesView initialKey={key} />
}
