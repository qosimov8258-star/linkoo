"use client"

import { useState } from "react"
import { X } from "lucide-react"

import { CheckBox, LineField, LineSelect } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

// Full-screen "Добавление" / "Изменить" form of the reference's "Опросник": survey data on the left, the question
// constructor (questions with answers) on the right. Positions follow the reference at 1500x900.

export type SurveyQuestionDraft = { text: string; type: string; maxAnswers: string; format: string; orderNo: string; required: boolean; answers: string[] }
export type SurveyDraft = {
  name: string
  orderNo: string
  organization: string
  storeType: string
  active: boolean
  comment: string
  flags: { required: boolean; storeCheck: boolean; scoring: boolean; perfect: boolean }
  questions: SurveyQuestionDraft[]
}

export const QUESTION_TYPES = ["Выбрать одну", "Выбрать несколько", "Вводит текст", "Продукт"]
export const QUESTION_FORMATS = ["Текст", "Число"]
const REQUIRED = "Это поле обязательно к заполнению"

export const emptyQuestion = (): SurveyQuestionDraft => ({ text: "", type: "", maxAnswers: "", format: "", orderNo: "", required: false, answers: [""] })
export const emptySurveyDraft = (): SurveyDraft => ({
  name: "",
  orderNo: "",
  organization: "",
  storeType: "",
  active: false,
  comment: "",
  flags: { required: false, storeCheck: false, scoring: false, perfect: false },
  questions: [emptyQuestion()],
})

function ErrorText({ show }: { show: boolean }) {
  const { t } = useLanguage()
  return show ? <p className="mt-[3px] h-[12px] text-[12px] leading-[12px] text-[#d32f2f]">{t(REQUIRED)}</p> : null
}

function PlusMinus({ last, onClick, className = "" }: { last: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={last ? "+" : "−"} className={`flex items-center justify-center ${className}`}>
      {last ? (
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M19 13H5v-2h14v2z" /></svg>
      )}
    </button>
  )
}

export function SurveyForm({
  title,
  draft,
  organizations,
  clientTypes,
  onChange,
  onSave,
  onClose,
}: {
  title: string
  draft: SurveyDraft
  organizations: string[]
  clientTypes: string[]
  onChange: (next: SurveyDraft) => void
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [submitted, setSubmitted] = useState(false)
  const [alertLines, setAlertLines] = useState<string[] | null>(null)

  const patch = (partial: Partial<SurveyDraft>) => onChange({ ...draft, ...partial })
  const patchQuestion = (index: number, partial: Partial<SurveyQuestionDraft>) =>
    patch({ questions: draft.questions.map((question, i) => (i === index ? { ...question, ...partial } : question)) })

  function submit() {
    setSubmitted(true)
    const lines: string[] = []
    if (!draft.name.trim()) lines.push(`name: ${t(REQUIRED)}`)
    for (const question of draft.questions) {
      if (!question.text.trim()) lines.push(`name: ${t(REQUIRED)}`)
      for (const answer of question.answers) if (!answer.trim()) lines.push(`name: ${t(REQUIRED)}`)
    }
    if (lines.length) {
      setAlertLines(lines)
      return
    }
    onSave()
  }

  return (
    <div className="fixed inset-0 z-[1400] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
        <b className="text-[13px] font-bold uppercase tracking-[0.2px]">{t(title)}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <X className="h-6 w-6" strokeWidth={1.5} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[450px_minmax(0,1fr)]">
        <aside className="overflow-y-auto px-[30px] pb-[20px] pt-[24px]">
          <LineField label={t("Название")} value={draft.name} onChange={(value) => patch({ name: value })} />
          {submitted && !draft.name.trim() && <ErrorText show />}
          <div className={submitted && !draft.name.trim() ? "mt-[12px]" : "mt-[12px]"}>
            <LineField label={t("Порядковый номер")} value={draft.orderNo} onChange={(value) => patch({ orderNo: value })} />
          </div>
          <div className="mt-[27px]">
            <LineSelect label={t("Организация")} value={draft.organization} onChange={(value) => patch({ organization: value })} options={organizations} />
          </div>
          <div className="mt-[22px]">
            <LineSelect label={t("Тип клиента")} value={draft.storeType} onChange={(value) => patch({ storeType: value })} options={clientTypes} />
          </div>
          <div className="mt-[12px] space-y-[10.5px]">
            <CheckBox checked={draft.flags.required} onChange={(value) => patch({ flags: { ...draft.flags, required: value } })} label={t("Обязательный")} />
            <CheckBox checked={draft.flags.storeCheck} onChange={(value) => patch({ flags: { ...draft.flags, storeCheck: value } })} label="Store Check" />
            <CheckBox checked={draft.active} onChange={(value) => patch({ active: value })} label={t("Активный")} />
            <CheckBox checked={draft.flags.scoring} onChange={(value) => patch({ flags: { ...draft.flags, scoring: value } })} label={t("Имеет систему оценки")} />
            <CheckBox checked={draft.flags.perfect} onChange={(value) => patch({ flags: { ...draft.flags, perfect: value } })} label="Perfect Store" />
          </div>
          <div className="mt-[22px]">
            <LineField label={t("Оставить комментарий...")} value={draft.comment} onChange={(value) => patch({ comment: value })} />
          </div>
        </aside>
        <main className="min-w-0 overflow-y-auto bg-[#f0f4f8] px-[20px] pb-[20px] pt-[10px]">
          <p className="text-[15px] font-semibold leading-[20px]">{t("Список вопросов")}</p>
          <div className="mt-[10px] bg-white p-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.16)]">
            {draft.questions.map((question, index) => {
              const last = index === draft.questions.length - 1
              const textError = submitted && !question.text.trim()
              return (
                <section key={index} className={`min-h-[680px] ${last ? "" : "mb-[20px]"}`}>
                  <div className="flex h-[80px] items-center justify-between bg-[#f0f4f8] px-[20px]">
                    <b className="text-[20px] font-bold">{t("Вопрос")} № {index + 1}</b>
                    <PlusMinus
                      last={last}
                      onClick={() => (last ? patch({ questions: [...draft.questions, emptyQuestion()] }) : patch({ questions: draft.questions.filter((_, i) => i !== index) }))}
                      className="h-[40px] w-[40px] rounded-[4px] bg-[#4f71dc] text-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
                    />
                  </div>
                  <div className="grid grid-cols-[390px_minmax(0,1fr)] gap-x-[34px]">
                    <div className="pt-[13px]">
                      <LineField label={t("Напишите вопрос")} value={question.text} onChange={(value) => patchQuestion(index, { text: value })} />
                      <ErrorText show={textError} />
                      <div className="mt-[27px]">
                        <LineSelect label={t("Тип")} value={question.type} onChange={(value) => patchQuestion(index, { type: value })} options={QUESTION_TYPES} />
                      </div>
                      <div className="mt-[12px]">
                        <LineField label={t("Максимум ответов")} value={question.maxAnswers} onChange={(value) => patchQuestion(index, { maxAnswers: value })} />
                      </div>
                      <div className="mt-[27px]">
                        <LineSelect label={t("Формат")} value={question.format} onChange={(value) => patchQuestion(index, { format: value })} options={QUESTION_FORMATS} />
                      </div>
                      <div className="mt-[12px]">
                        <LineField label={t("Порядковый номер")} value={question.orderNo} onChange={(value) => patchQuestion(index, { orderNo: value })} />
                      </div>
                      <div className="mt-[19px]">
                        <CheckBox checked={question.required} onChange={(value) => patchQuestion(index, { required: value })} label={t("Обязательный вопрос")} />
                      </div>
                    </div>
                    <div>
                      <p className="pt-[6px] text-[20px] font-bold leading-[28px]">{t("Ответы")}</p>
                      {question.answers.map((answer, answerIndex) => {
                        const answerLast = answerIndex === question.answers.length - 1
                        return (
                          <div key={answerIndex} className="mr-[3px] mt-[15px] flex h-[72px] items-end justify-between bg-white pb-[18px] pl-[20px] pr-[28px] shadow-[0_1px_6px_rgba(0,0,0,0.16)]">
                            <div className="mr-[18px] flex-1">
                              <LineField
                                label={`${t("Ответ")} #${answerIndex + 1}`}
                                value={answer}
                                onChange={(value) => patchQuestion(index, { answers: question.answers.map((item, i) => (i === answerIndex ? value : item)) })}
                              />
                            </div>
                            <PlusMinus
                              last={answerLast}
                              onClick={() =>
                                answerLast
                                  ? patchQuestion(index, { answers: [...question.answers, ""] })
                                  : patchQuestion(index, { answers: question.answers.filter((_, i) => i !== answerIndex) })
                              }
                              className="mb-[6px] h-[24px] w-[24px] text-[#222]"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] px-[26px]">
        <button type="button" onClick={submit} className="text-[13px] font-bold uppercase text-[#0a9ddb]">
          {t("СОХРАНИТЬ")}
        </button>
      </footer>
      {alertLines && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54]" onClick={() => setAlertLines(null)}>
          <div onClick={(event) => event.stopPropagation()} className="flex h-[300px] w-[400px] flex-col items-center bg-white px-[15px] pb-[20px] pt-[24px] shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
            <span className="flex h-[48px] w-[48px] items-center justify-center rounded-full border-[3px] border-[#4f71dc] text-[26px] font-bold leading-none text-[#4f71dc]">!</span>
            <div className="mt-[16px] flex-1 text-center text-[15px] leading-[19px]">
              {alertLines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
            <button type="button" onClick={() => setAlertLines(null)} className="h-[40px] w-full rounded-[3px] bg-[#4f71dc] text-[13px] font-bold text-white">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
