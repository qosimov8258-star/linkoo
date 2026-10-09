import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listCustomerPayments, parseCustomerPaymentsQuery } from "@/lib/cash/customer-payments"

// GET /api/cash/customer-payments?tab&search&from&to&acceptedFrom&acceptedTo&invoiceFrom&invoiceTo&invoice&branch*&deliveryMan*
//   &organization*&clientType*&cashbox*&zone*&client*&createdBy*&acceptedBy*&responsibleAgent*&responsibleDeliverer*&status
//   &currency&notAccept&ordering&page&pageSize → CustomerPaymentsResult ("Оплаты от клиентов", live rows only).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseCustomerPaymentsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listCustomerPayments(parsed.data))
}
