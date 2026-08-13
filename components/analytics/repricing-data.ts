export type Repricing = {
  id: number
  createdBy: string
  createdAt: string
  priceListId: number | null
  priceList: string
  productId: number | null
  product: string
  amount: number
  currency: "SUM" | "USD" | "Euro"
  status: "проведен" | "черновик"
  user: string
}

export const repricingCurrencies = ["SUM", "USD", "Euro"] as const
