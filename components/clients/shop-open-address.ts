"use client"

import { useSyncExternalStore, type MouseEvent } from "react"

// The address of an open shop card (Linko's shared ShopDetail drawer). A page that shows the card keeps its shop in the
// query: ?openShop=<id> (Linko's OPEN_SHOP_DETAILS / OPEN_SHOP_DIALOG) or ?openShopDetail=<id> (SHOP_DETAIL: Территория,
// a return's «Клиент»); a client of an agent's day also writes drawer=shop. The card's X writes
// <param>=0&drawer=drawer_agent_visit (Linko's handleCloseShopDetails). Linko opens the card through a link and closes it
// with hashHistory.push, so both are history entries: Back closes the card again, and a client's link opens the card in a
// new tab. Pages read the address through useAddressSearch(), which follows these writes and Back / Forward.

/** Linko's query keys of the open shop. */
export type ShopParam = "openShop" | "openShopDetail"

/** The «drawer» value a client of the agent's day writes, and the one the card's X leaves. */
export const SHOP_DRAWER = "shop"
export const AGENT_DRAWER = "drawer_agent_visit"

const ADDRESS_EVENT = "mezon:address"

/** A positive id of a query value (null when absent, 0 or not a positive integer). */
export function shopIdOf(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id > 0 && id <= 2_147_483_647 ? id : null
}

/** The open shop of the current address. */
export function readShopParam(param: ShopParam): number | null {
  if (typeof window === "undefined") return null
  return shopIdOf(new URLSearchParams(window.location.search).get(param))
}

/** The current address with `patch` applied (null removes a key). */
function patchedAddress(patch: Record<string, string | null>): string {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const search = params.toString()
  return `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
}

/** Writes `patch` into the address, as a new history entry ("push") or in place, and tells useAddressSearch(). */
export function writeAddressParams(patch: Record<string, string | null>, history: "push" | "replace" = "push"): void {
  if (typeof window === "undefined") return
  const next = patchedAddress(patch)
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  if (history === "push") window.history.pushState(window.history.state, "", next)
  else window.history.replaceState(window.history.state, "", next)
  window.dispatchEvent(new Event(ADDRESS_EVENT))
}

type ShopOptions = {
  /** The «drawer» written with an open shop (a client of the agent's day: SHOP_DRAWER); a map pin leaves it. */
  drawer?: string
  /** Other keys of the page written with it (Территория's openInfo=true). */
  extra?: Record<string, string>
}

function shopPatch(param: ShopParam, id: number | null, options: ShopOptions): Record<string, string | null> {
  const patch: Record<string, string | null> = { [param]: String(id ?? 0) }
  if (id === null) patch.drawer = AGENT_DRAWER
  else if (options.drawer) patch.drawer = options.drawer
  return { ...patch, ...(options.extra ?? {}) }
}

/** Opens (`id`) or closes (null: <param>=0&drawer=drawer_agent_visit) the shop card in the address. */
export function writeShopParam(param: ShopParam, id: number | null, options: ShopOptions & { history?: "push" | "replace" } = {}): void {
  writeAddressParams(shopPatch(param, id, options), options.history ?? "push")
}

/** The link of a shop card on this page (a client's name: a plain click opens it here, Ctrl / middle click in a new tab). */
export function shopHref(param: ShopParam, id: number, options: ShopOptions = {}): string {
  if (typeof window === "undefined") return "#"
  return patchedAddress(shopPatch(param, id, options))
}

/** A plain left click (no modifier key): the page handles it; any other click is left to the browser's link. */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback)
  window.addEventListener(ADDRESS_EVENT, callback)
  return () => {
    window.removeEventListener("popstate", callback)
    window.removeEventListener(ADDRESS_EVENT, callback)
  }
}

/** The query string of the address ("" on the server), following writeAddressParams and Back / Forward. */
export function useAddressSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  )
}

/** The open shop of `param` in the address, following its changes. */
export function useAddressShop(param: ShopParam): number | null {
  return shopIdOf(new URLSearchParams(useAddressSearch()).get(param))
}
