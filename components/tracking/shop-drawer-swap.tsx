"use client"

import { ClientDrawer } from "@/components/clients/clients-view"

// The full shop card of Linko's pages with an agent panel or a map: Отслеживание (#/tracking/<agent>), Анализ маршрутов
// (#/plan/<agent>), the agent drawer of the visit reports and dashboards (drawer_agent_visit) and Территория (#/zones).
// A client of the agent's day adds drawer=shop&openShop=<id> to the address, «Показать клиента» of a map pin only
// openShop=<id>, a pin of Территория openInfo=true&openShopDetail=<id> (components/clients/shop-open-address.ts); the
// page then shows the shop card (АКТИВНОСТЬ / ЗАДАЧИ / КЛИЕНТ / ОТЧЕТЫ / ОТКАЗЫ) where its agent panel or zones panel
// was. Only the card's X closes it, writing <param>=0&drawer=drawer_agent_visit: the panel comes back.

/** The pencil of the card: the client's edit form on Клиенты, in a new tab (as on the other pages that host the card). */
export const shopEditHref = (id: number) => `/clients?openShop=${id}&openUpdateDialog=true`

/** The shop card filling the host's panel (the agent panel's or the zones panel's place); `onClose` must be stable. */
export function EmbeddedShopCard({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  return <ClientDrawer key={clientId} clientId={clientId} onClose={onClose} editHref={shopEditHref(clientId)} embedded />
}
