import { writeAddressParams } from "@/components/clients/shop-open-address"

// Linko's dynamic reports keep their period in the address (#/dynamic-reports/<key>/?beginDate=…&endDate=…): a link or a
// reload opens the report on that period, and «Применить» writes the new one.

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The report period of the address (null when absent or invalid). */
export function periodInAddress(): { from: string; to: string } | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const from = params.get("beginDate") ?? ""
  const to = params.get("endDate") ?? ""
  return DAY.test(from) && DAY.test(to) && from <= to ? { from, to } : null
}

/** Puts the applied period into the address. */
export function writePeriodToAddress(from: string, to: string): void {
  writeAddressParams({ beginDate: from, endDate: to }, "replace")
}
