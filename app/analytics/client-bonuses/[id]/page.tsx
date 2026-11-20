import type { Metadata } from "next"

import { ClientBonusesView } from "@/components/orders/client-bonuses-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Бонусы клиентов")} — Mezon` }
}

// A client's bonus history over the «Бонусы клиентов» list (Linko's #/client-bonuses/<id>): the list reads the id from
// the address.
export default function ClientBonusesItemPage() {
  return <ClientBonusesView />
}
