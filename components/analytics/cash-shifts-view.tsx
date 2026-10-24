"use client"

import { useState } from "react"

import { ListBTable } from "@/components/analytics/list-b-table"
import { RefCard, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

// "Смена" (demo #/change, Продажи → Смена): cashiers' cash shifts — Смена | Пользователь |
// Дата создания | В начале | Пришло | Расход | Ожидается | Фактически | Разнится | Дата закрытия,
// search and the paginator. The reference account has no shifts yet ("1 - 0 из 0"), and the
// cash core has no shift documents, so the list is empty until a shift module records them.

const COLUMNS = ["Смена", "Пользователь", "Дата создания", "В начале", "Пришло", "Расход", "Ожидается", "Фактически", "Разнится", "Дата закрытия"]

export function CashShiftsView() {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  return (
    <RefPage>
      <RefHeader title={t("Смена")} />
      <RefCard className="bg-white">
        <RefToolbar hideFilter query={query} onQuery={setQuery} pageSize={pageSize} onPageSize={setPageSize} from={1} to={0} total={0} page={1} pageCount={1} onPage={() => {}} />
        <ListBTable
          cols="123px 231px 115px 116px 115px 115px 116px 115px 115px 1fr"
          minWidth={1200}
          cellPad={0}
          heads={COLUMNS.map((label) => t(label))}
          rows={[] as string[]}
          rowKey={(row) => row}
          render={() => []}
          empty={
            <div className="-my-16 flex h-[276px] flex-col items-center bg-white pt-[58px] text-[13px] text-[#666]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="w-[164px]" />
              <span className="mt-[2px]">{t("По вашему запросу ничего не найдено")}</span>
            </div>
          }
        />
      </RefCard>
    </RefPage>
  )
}
