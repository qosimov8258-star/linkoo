"use client"

import { StoreTimeView } from "./store-time-view"

// The reference "Анализ цен" report shares the store-check filter set
// (Создал / Опрос / Продукты) and its empty-state result.
export function PriceAnalysisView() {
  return <StoreTimeView productCheckMode title="Анализ цен" />
}
