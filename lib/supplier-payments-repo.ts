import "server-only"

import { listSupplierPaymentsPage, listSupplyPayments, paidBySupply, type SupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import type { SupplierPaymentsResult } from "@/components/analytics/supplier-payments-data"

// "Оплаты поставщикам": supplier_payments are written only by the cash core
// (lib/cash/write.ts — cash page «Расход» with a provider / supply category and
// paid money requests); the read model lives in lib/cash/supplier-payments.ts.
// This module keeps the historical import path for older callers.

export type { SupplierPaymentsQuery }

/** Live (not soft-deleted) supplier payments, paged and filtered, with the totals strip. */
export async function listSupplierPayments(query: SupplierPaymentsQuery = {}): Promise<SupplierPaymentsResult> {
  return listSupplierPaymentsPage(query)
}

export { listSupplyPayments, paidBySupply }
