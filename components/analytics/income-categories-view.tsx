"use client"

import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { CategoriesGrid, formatCategoryDate, type CategoryColumn } from "./categories-grid"
import { CategoryOptionChips } from "./category-options-picker"
import type { IncomeCategory } from "./income-categories-data"

// "Категории приходов" (demo #/income-category, chunk c58 module 4711; API
// finance/income_category/). Columns exactly as the demo header: Наименование (xs 3) |
// Параметры (xs 5, option chips with the description tooltip) | Дата создания (xs 3,
// sortable) | ✎ / 🗑 on hover. Dialog: category-form-modal.tsx (Наименование ★,
// Дополнительные параметры → option list, Прочий приход); delete confirm and import:
// categories-dialogs.tsx; grid / URL state: categories-grid.tsx.

export function IncomeCategoriesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <IncomeCategoriesGrid />
  return (
    <CatalogPageLayout>
      <IncomeCategoriesGrid />
    </CatalogPageLayout>
  )
}

function IncomeCategoriesGrid() {
  const { language } = useLanguage()
  const columns: CategoryColumn<IncomeCategory>[] = [
    { key: "name", title: "Наименование", width: "3fr", className: "break-words", render: (row) => row.name },
    { key: "options", title: "Параметры", width: "5fr", render: (row) => <CategoryOptionChips options={row.options} /> },
    {
      key: "created_date", indent: true,
      title: "Дата создания",
      width: "2fr",
      ordering: "created_date",
      className: "whitespace-nowrap",
      render: (row) => (row.createdDate ? formatCategoryDate(row.createdDate, language) : ""),
    },
  ]
  return <CategoriesGrid kind="income" columns={columns} addLabel="добавить категорию приходов" minWidth="min-w-[720px]" />
}
