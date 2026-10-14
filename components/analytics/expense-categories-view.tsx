"use client"

import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { CategoriesGrid, formatCategoryDate, type CategoryColumn } from "./categories-grid"
import { CategoryOptionChips } from "./category-options-picker"
import type { ExpenseCategory } from "./expense-categories-data"

// "Категории расходов" (demo #/expensive-category, chunk c57 module 4709; API
// finance/expense_category/). Columns as the demo header: Наименование (xs 3) | Параметры
// (xs 3, option chips with the description tooltip) | Род. категория (xs 2, "Не указано") |
// Дата создания (xs 1, sortable) | Внутренний расход (xs 2: "Прямой расход на товар" /
// "Косвенный расход"; the demo header sorts it by created_date, ours by the flag) | ✎ / 🗑
// on hover. Dialog: category-form-modal.tsx; delete confirm (refused while used or while
// the category has children) and import: categories-dialogs.tsx; grid: categories-grid.tsx.

export function ExpenseCategoriesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <ExpenseCategoriesGrid />
  return (
    <CatalogPageLayout>
      <ExpenseCategoriesGrid />
    </CatalogPageLayout>
  )
}

function ExpenseCategoriesGrid() {
  const { t, language } = useLanguage()
  const columns: CategoryColumn<ExpenseCategory>[] = [
    { key: "name", title: "Наименование", width: "w-[22%]", className: "font-medium break-words", render: (row) => row.name },
    { key: "options", title: "Параметры", width: "w-[23%]", render: (row) => <CategoryOptionChips options={row.options} /> },
    { key: "parent", title: "Род. категория", width: "w-[16%]", className: "break-words", render: (row) => row.parentName || t("Не указано") },
    {
      key: "created_date",
      title: "Дата создания",
      width: "w-[14%]",
      ordering: "created_date",
      className: "whitespace-nowrap",
      render: (row) => (row.createdDate ? formatCategoryDate(row.createdDate, language) : ""),
    },
    {
      key: "direct",
      title: "Внутренний расход",
      width: "w-[17%]",
      ordering: "direct",
      render: (row) => (row.direct ? t("Прямой расход на товар") : t("Косвенный расход")),
    },
  ]
  return <CategoriesGrid kind="expense" columns={columns} addLabel="добавить категорию расходов" minWidth="min-w-[960px]" />
}
