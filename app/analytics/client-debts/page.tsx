import { redirect } from "next/navigation"

// The dashboard tab "ДОЛГ КЛИЕНТОВ" is the demo's #/statistics/debtors?toggle=order, i.e. "Долги с заказов".
export default function ClientDebtsPage() {
  redirect("/analytics/order-debts?toggle=order&pageSize=25")
}
