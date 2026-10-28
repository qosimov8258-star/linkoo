"use client"

import { ProfitReportView } from "@/components/analytics/profit-report-view"

export function ProductProfitView() {
  return (
    <ProfitReportView
      title="Прибыль от товаров"
      realizedLabel="ПРОДАЖА ПО ТОВАРАМ С ПРИБЫЛЬЮ"
      fileName="product-profit.xls"
      groupings={[
        { label: "По продукту", entity: "Товар", source: "products" },
        { label: "По типу продукта", entity: "Тип продукта", source: "productTypes" },
        { label: "По бренду", entity: "Бренд", source: "brands" },
      ]}
    />
  )
}
