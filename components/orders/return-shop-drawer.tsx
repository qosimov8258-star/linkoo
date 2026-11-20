"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { ClientDrawer } from "@/components/clients/clients-view"
import { readShopParam, writeShopParam } from "@/components/clients/shop-open-address"

// The shop card a return's «Клиент» opens (Linko's shop drawer, ?openShopDetail=<shop id>). Like Linko's, it also opens
// over the returns list without a card (/analytics/returns?openShopDetail=<id>), and its X leaves
// drawer=drawer_agent_visit&openShopDetail=0 in the address. Other pages that show a return card (Активность) keep
// their own address.

const onReturnsPage = () => typeof window !== "undefined" && window.location.pathname.startsWith("/analytics/returns")

/** The shop of ?openShopDetail=<id> on the returns page (none for Linko's 0 after its X, or on another page). */
export function shopInAddress(): number | null {
  return onReturnsPage() ? readShopParam("openShopDetail") : null
}

/** Puts the open shop into the returns page address (?openShopDetail=<id>; once closed, Linko's
 * drawer=drawer_agent_visit&openShopDetail=0), in place. */
export function writeShopToAddress(id: number | null) {
  if (onReturnsPage()) writeShopParam("openShopDetail", id, { history: "replace" })
}

/** The drawer in the page body. `overDialog` lifts it over a return card shown in a dialog (z-90, Активность), so it
 * can be used there too; `onClose` must be stable (the drawer reloads the shop when it changes). */
export function ReturnShopDrawer({ shopId, onClose, overDialog = false }: { shopId: number; onClose: () => void; overDialog?: boolean }) {
  const drawer = <ClientDrawer key={shopId} clientId={shopId} onClose={onClose} editHref={`/clients?openShop=${shopId}&openUpdateDialog=true`} />
  return createPortal(overDialog ? <div className="relative z-[95]">{drawer}</div> : drawer, document.body)
}

/** The drawer over the returns list while no card is open (Linko: #/return?openShopDetail=3503). */
export function ReturnsListShopDrawer() {
  const [shopId, setShopId] = useState<number | null>(null)
  useEffect(() => setShopId(shopInAddress()), [])
  const close = useCallback(() => {
    setShopId(null)
    writeShopToAddress(null)
  }, [])
  return shopId === null ? null : <ReturnShopDrawer shopId={shopId} onClose={close} />
}
