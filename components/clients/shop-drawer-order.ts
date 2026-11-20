"use client"

import { createContext, useContext } from "react"

// A page that shows an order card over itself (Linko's ?orderDetails=<order id>, e.g. Финансы → Долги с заказов) hands
// the shop drawer this link, so ЗАДАЧИ «Просмотреть» opens the order there (the drawer stays open under it) instead of
// leaving for the order page. Without a provider the drawer keeps its link to the order page.

export type ShopDrawerOrderLink = {
  /** The page's own address with the order card open (for a middle click or "open in new tab"). */
  href: (orderId: number) => string
  /** Opens the order card on the page. */
  open: (orderId: number) => void
}

export const ShopDrawerOrderContext = createContext<ShopDrawerOrderLink | null>(null)

export function useShopDrawerOrderLink(): ShopDrawerOrderLink | null {
  return useContext(ShopDrawerOrderContext)
}
