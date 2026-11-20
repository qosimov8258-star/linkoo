"use client"

import { ListBTable } from "@/components/analytics/list-b-table"
import { toggleOrdering, useListUrlState } from "@/components/analytics/list-url-state"
import { GridSortHead } from "@/components/ref/grid-sort-head"
import { RefCard, RefHeader, RefNothingFound, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

// "Смена" (the reference's #/change, Продажи → Смена; API pos/shift/): cashiers' cash shifts — Смена | Пользователь |
// Дата создания | В начале | Пришло | Расход | Ожидается | Фактически | Разнится | Дата закрытия, search and the
// paginator (no filter, no check boxes: Linko's list header only offers them next to a filter). The reference account has
// no shifts ("1 - 0 из 0", pos/shift/ answers count 0) and the cash core here has no shift documents, so the list is
// empty. The address keeps Linko's state: pageSize, page, search and the header sort (ordering=<field>, -<field>, then
// dropped; the sortable fields are Linko's).

const ORDERINGS = ["shiftNumber", "openBy.firstName", "beginAmount", "outcome", "factAmount", "diffAmount", "endTime"] as const

/** Linko's header: 12 grid units (xs 1 / 2 / 1 / 1 / 1 / 1 / 1 / 1 / 1 / 2) with the sortable ones as buttons. */
const COLUMNS: { label: string; field?: (typeof ORDERINGS)[number] }[] = [
  { label: "Смена", field: "shiftNumber" },
  { label: "Пользователь", field: "openBy.firstName" },
  { label: "Дата создания" },
  { label: "В начале", field: "beginAmount" },
  { label: "Пришло" },
  { label: "Расход", field: "outcome" },
  { label: "Ожидается" },
  { label: "Фактически", field: "factAmount" },
  { label: "Разнится", field: "diffAmount" },
  { label: "Дата закрытия", field: "endTime" },
]
const COLS = "minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)"

export function CashShiftsView() {
  const { t } = useLanguage()
  const { state, update } = useListUrlState({ base: "/analytics/cash-shifts", dialogParam: "openCreateDialog", orderings: ORDERINGS })
  const sort = (field: string) => update({ ordering: toggleOrdering(state.ordering, field) })
  return (
    <RefPage>
      <RefHeader title={t("Смена")} />
      <RefCard className="bg-white">
        <RefToolbar
          hideFilter
          query={state.search}
          onQuery={(search) => update({ search, page: 1 })}
          pageSize={state.pageSize}
          onPageSize={(pageSize) => update({ pageSize, page: 1 })}
          from={1}
          to={0}
          total={0}
          page={1}
          pageCount={1}
          onPage={() => {}}
        />
        <ListBTable
          cols={COLS}
          minWidth={1200}
          heads={COLUMNS.map((column, index) =>
            column.field ? (
              <GridSortHead key={column.label} label={t(column.label)} field={column.field} ordering={state.ordering} onSort={sort} className={index === 0 ? "-ml-2" : ""} />
            ) : (
              <span key={column.label}>{t(column.label)}</span>
            ),
          )}
          rows={[] as string[]}
          rowKey={(row) => row}
          render={() => []}
          empty={
            <div className="-mx-4 -my-16">
              <RefNothingFound />
            </div>
          }
        />
      </RefCard>
    </RefPage>
  )
}
