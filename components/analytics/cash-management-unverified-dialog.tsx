"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Pencil, Trash2, X } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { OperationDetails, type DetailsPopup } from "@/components/analytics/cash-management-details"
import { CashAmount, CashModal, EmptyBlock, ErrorBlock, LoadingBlock, MiniPager, formatCashDate, mutationError } from "@/components/analytics/cash-management-shared"
import type { CashListResult, CashOperation } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Неподтвержденные транзакции" (demo modules 3856 / 3857 / 3858): the clock
// icon's dialog. Rows like the main list plus Касса / Создал / Клиент; on hover
// delete (not for transfers), edit (not for transfers / acceptances) and verify
// ("Вы уверены?" → POST /api/cash/operations/[key]/verify, the date kept).

const PAGE_SIZE = 25

export function CashUnverifiedDialog({
  canWrite,
  refreshToken,
  onClose,
  onEdit,
  onDelete,
  onVerified,
  onPopup,
}: {
  canWrite: boolean
  refreshToken: number
  onClose: () => void
  onEdit: (operation: CashOperation) => void
  onDelete: (operation: CashOperation) => void
  onVerified: () => void
  onPopup: (popup: DetailsPopup) => void
}) {
  const { t, language } = useLanguage()
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { data, loading, error: loadError, reload } = useCashJson<CashListResult>(`/api/cash/unverified?page=${page}&pageSize=${PAGE_SIZE}`)

  useEffect(() => {
    if (refreshToken) reload()
  }, [refreshToken, reload])

  const verify = async (operation: CashOperation) => {
    setBusy(true)
    // The reference verifies without a date (verify_date null): the operation keeps its own date.
    const result = await cashMutate("POST", `/api/cash/operations/${encodeURIComponent(operation.key)}/verify`, { verifyDate: null })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    setConfirming(null)
    setError("")
    reload()
    onVerified()
  }

  return (
    <CashModal
      title={t("Неподтвержденные транзакции")}
      onClose={onClose}
      size="lg"
      headerExtra={
        data ? (
          <span className="mr-4 flex items-center gap-5 text-[13px] font-normal normal-case text-black">
            <span className="flex items-center gap-1">
              {PAGE_SIZE}
              <span className="ml-1 block h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#bdbdbd]" />
            </span>
            <MiniPager page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </span>
        ) : null
      }
    >
      {loading && !data && <LoadingBlock />}
      {loadError && <ErrorBlock error={loadError} onRetry={reload} />}
      {data && !data.rows.length && <EmptyBlock text="Неподтвержденных транзакций пока нет" />}
      {data && data.rows.length > 0 && (
        <div className="-mx-[30px] -mt-[15px] flex flex-col">
          <div className="grid h-[50px] grid-cols-[56px_minmax(0,1fr)_150px_170px] items-center gap-x-3 bg-[#5d6474] px-[30px] text-[13px] font-bold text-white">
            <span>№</span>
            <span>{t("Детали")}</span>
            <span>{t("Указанная дата")}</span>
            <span className="text-right">{t("Сумма")}</span>
          </div>
          {data.rows.map((operation) => {
            const transfer = operation.type === 1 || operation.type === 2
            const asking = confirming === operation.key
            return (
              <div key={operation.key} className="group relative grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2 overflow-hidden border-b border-dotted border-[#d9e0e5] px-[30px] py-3 hover:bg-[#f2f5f8] sm:grid-cols-[56px_minmax(0,1fr)_150px_170px]">
                <span className="text-black">{operation.docNo}</span>
                <OperationDetails operation={operation} showCashbox extended onPopup={onPopup} />
                <span className="col-start-2 text-[13px] text-[#586174] sm:col-start-auto">{formatCashDate(operation.date, language)}</span>
                <div className="col-start-2 flex flex-col items-start gap-2 sm:col-start-auto sm:items-end">
                  <CashAmount operation={operation} />
                  {error && asking && <span className="text-[12px] text-[#e57373]">{error}</span>}
                </div>
                {/* The reference slides its row actions over the amount on hover; «Вы уверены?» stays until answered. */}
                {canWrite && (
                  <div
                    className={`absolute inset-y-0 right-0 flex w-[20%] min-w-[170px] items-center justify-end gap-1 bg-[#f2f5f8] pr-[22px] transition-all duration-150 ${asking ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
                  >
                    {asking ? (
                      <>
                        <span className="mr-1 text-[13px] text-[#17233b]">{t("Вы уверены?")}</span>
                        <button type="button" disabled={busy} onClick={() => verify(operation)} aria-label={t("Подтвердить")} title={t("Подтвердить")} className="p-1.5 text-[#757575] hover:text-[#333] disabled:opacity-40">
                          <CheckCircle2 className="h-5 w-5" />
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} aria-label={t("Отмена")} title={t("Отмена")} className="p-1.5 text-[#757575] hover:text-[#333]">
                          <X className="h-5 w-5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={transfer} onClick={() => onDelete(operation)} aria-label={t("Удалить")} title={t("Удалить")} className="p-1.5 text-[#757575] hover:text-[#333] disabled:opacity-30">
                          <Trash2 className="h-5 w-5" />
                        </button>
                        <button type="button" disabled={transfer || operation.type === 8} onClick={() => onEdit(operation)} aria-label={t("Изменить")} title={t("Изменить")} className="p-1.5 text-[#757575] hover:text-[#333] disabled:opacity-30">
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setError("")
                            setConfirming(operation.key)
                          }}
                          aria-label={t("Подтвердить")}
                          title={t("Подтвердить")}
                          className="p-1.5 text-[#757575] hover:text-[#333]"
                        >
                          <CheckCircle2 className="h-5 w-5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </CashModal>
  )
}
