// The shop drawer's own query parameters (Linko's names): its tab (shopDrawerTab=task|detail|report|reject, none or
// "activity" for АКТИВНОСТЬ), the КЛИЕНТ sub-tab (marketTab=detail|logs|contracts|limitDebt), the open «Создать задачу»
// form (openCreateNotification=true), the «Баланс» period (activityFromDate / activityToDate), the ЛОГИ filter pill and
// page (type=order|order_return|client_transaction|market, dPage) and the «Изменение агентов» dialog
// (openAgentPL=true). The drawer writes them into the page's address next to the page's own parameters; pages that
// rebuild their address from their own state carry them over with keepShopDrawerParams while the drawer is open.
// Like Linko's, its X leaves the tab parameters in the address, so the drawer opens again on the tab it was left on.

export const SHOP_DRAWER_PARAMS = ["shopDrawerTab", "marketTab", "openCreateNotification", "activityFromDate", "activityToDate", "type", "dPage", "openAgentPL"] as const

export type ShopDrawerParam = (typeof SHOP_DRAWER_PARAMS)[number]

/** The drawer parameter of the current address (null on the server or when absent). */
export function readShopDrawerParam(name: ShopDrawerParam): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get(name)
}

/** Sets (or, with null, removes) drawer parameters in the current address: in place by default, as a new history entry
 * with "push" (Linko's tab and sub-tab clicks, so Back returns to the previous tab). */
export function writeShopDrawerParams(patch: Partial<Record<ShopDrawerParam, string | null>>, mode: "replace" | "push" = "replace"): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  for (const [name, value] of Object.entries(patch)) {
    if (value === null || value === undefined) params.delete(name)
    else params.set(name, value)
  }
  const search = params.toString()
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  if (mode === "push") window.history.pushState(window.history.state, "", next)
  else window.history.replaceState(window.history.state, "", next)
}

/** Removes every drawer parameter. */
export function clearShopDrawerParams(): void {
  writeShopDrawerParams(Object.fromEntries(SHOP_DRAWER_PARAMS.map((name) => [name, null])))
}

/** The drawer was closed with its X: its open form and dialog go, its tabs, period and ЛОГИ page stay (Linko). */
export function closeShopDrawerParams(): void {
  writeShopDrawerParams({ openCreateNotification: null, openAgentPL: null })
}

/** Copies the drawer parameters of the current address into `target` (a page rebuilding its address keeps them). */
export function keepShopDrawerParams(target: URLSearchParams): URLSearchParams {
  if (typeof window === "undefined") return target
  const current = new URLSearchParams(window.location.search)
  for (const name of SHOP_DRAWER_PARAMS) {
    const value = current.get(name)
    if (value !== null && !target.has(name)) target.set(name, value)
  }
  return target
}
