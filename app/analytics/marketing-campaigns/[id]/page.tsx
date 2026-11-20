import type { Metadata } from "next"

import { MarketingCampaignsView } from "@/components/orders/marketing-campaigns-view"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Маркетинговые акции")} — Mezon` }
}

// A promotion's card over the «Маркетинговые акции» list (Linko's #/prices/<id>): the list reads the id from the
// address.
export default function MarketingCampaignPage() {
  return <MarketingCampaignsView />
}
