"use client"

import { useEffect, useState } from "react"
import { Check, Pencil, Trash2, X } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { OperationDetails, type DetailsPopup } from "@/components/analytics/cash-management-details"
import { CashAmount, CashModal, EmptyBlock, ErrorBlock, LoadingBlock, MiniPager, formatCashDate, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import type { CashListResult, CashOperation } from "@/lib/cash/types"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Неподтвержденные транзакции" (demo modules 3856 / 3857 / 3858): the clock
// icon's dialog. Rows like the main list plus Касса / Создал; delete (not for
// transfers), edit (not for transfers / acceptances) and verify ("Вы
// уверены?" + Дата → POST /api/cash/operations/[key]/verify).

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
  const [verifyDate, setVerifyDate] = useState(() => todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { data, loading, error: loadError, reload } = useCashJson<CashListResult>(`/api/cash/unverified?page=${page}&pageSize=${PAGE_SIZE}`)

  useEffect(() => {
    if (refreshToken) reload()
  }, [refreshToken, reload])

  const verify = async (operation: CashOperation) => {
    setBusy(true)
    const result = await cashMutate("POST", `/api/cash/operations/${encodeURIComponent(operation.key)}/verify`, { verifyDate: verifyDate || null })
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
            return (
              <div key={operation.key} className="group grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-dotted border-[#d9e0e5] px-[30px] py-3 sm:grid-cols-[56px_minmax(0,1fr)_150px_170px]">
                <span className="text-black">{operation.docNo}</span>
                <OperationDetails operation={operation} showCashbox extended onPopup={onPopup} />
                <span className="col-start-2 text-[13px] text-[#586174] sm:col-start-auto">{formatCashDate(operation.date, language)}</span>
                <div className="col-start-2 flex flex-col items-start gap-2 sm:col-start-auto sm:items-end">
                  <CashAmount operation={operation} />
                  {canWrite && confirming !== operation.key && (
                    <span className="flex items-center gap-3">
                      <button type="button" disabled={transfer} onClick={() => onDelete(operation)} aria-label={t("Удалить")} title={t("Удалить")} className="text-[#e57373] disabled:opacity-30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button type="button" disabled={transfer || operation.type === 8} onClick={() => onEdit(operation)} aria-label={t("Изменить")} title={t("Изменить")} className="text-[#4f70e7] disabled:opacity-30">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError("")
                          setVerifyDate(todayIso())
                          setConfirming(operation.key)
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-[#71ce87] px-3 py-1 text-[13px] font-semibold text-white"
                      >
                        <Check className="h-4 w-4" /> {t("Подтвердить")}
                      </button>
                    </span>
                  )}
                  {confirming === operation.key && (
                    <div className="flex w-full flex-col gap-2 rounded-md bg-[#f7f9fc] p-2 text-[13px]">
                      <span className="font-semibold text-[#17233b]">{t("Вы уверены?")}</span>
                      <label className="flex flex-col gap-1 text-[#586174]">
                        {t("Дата")}
                        <input type="date" value={verifyDate} onChange={(event) => setVerifyDate(event.target.value)} className={inputClass} />
                      </label>
                      {error && <span className="text-[#e57373]">{error}</span>}
                      <span className="flex justify-end gap-2">
                        <button type="button" onClick={() => setConfirming(null)} aria-label={t("Отмена")} className="rounded-md border border-[#dbe0e8] p-1.5 text-[#586174]">
                          <X className="h-4 w-4" />
                        </button>
                        <button type="button" disabled={busy} onClick={() => verify(operation)} aria-label={t("Подтвердить")} className="rounded-md bg-[#71ce87] p-1.5 text-white disabled:opacity-50">
                          <Check className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CashModal>
  )
}
