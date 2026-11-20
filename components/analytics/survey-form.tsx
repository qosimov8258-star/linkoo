"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { CheckBox, LineField, LineSelect, SaveLink } from "@/components/analytics/catalog-ui"
import { KitSearchSelect, type KitOption } from "@/components/orders/field-filter-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// Full-screen «Добавление» / «Изменение № N» / «Дублирование» form of the reference's «Опросник»: the survey data on
// the left (480 px), the question constructor on the right, one card per question. A question shows the fields of its
// type as the reference does:
//   * «Выбрать одну» / «Выбрать несколько»: Максимум ответов, Формат, Обязательный вопрос and the «Ответы» column
//     (each answer with its «Оценка» when the survey «Имеет систему оценки»);
//   * «Вводит текст»: the same fields without the «Ответы» column;
//   * «Продукт»: Face check / Price check / Продукт конкурента and the «Список товаров» column (own or rival products);
//   * with «Perfect Store» ticked the types are Продукт / Инвентарь / Планограмма (Минимальное количество, ID
//     планограммы and their switches), and a question without a type becomes «Продукт».

export type SurveyProduct = { id: number; name: string }
export type SurveyQuestionDraft = {
  text: string
  type: string
  maxAnswers: string
  format: string
  orderNo: string
  required: boolean
  answers: string[]
  balls: string[]
  checkAmount: boolean
  checkPrice: boolean
  isRival: boolean
  products: SurveyProduct[]
  rivalProducts: SurveyProduct[]
  minimumQuantity: string
  planogramId: string
  fullyOutOfStock: boolean
  allProductsHavePriceTag: boolean
  requirePlanogramExistsInStore: boolean
}
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
/** The question types of a Perfect Store survey. */
export const PERFECT_STORE_TYPES = ["Продукт", "Инвентарь", "Планограмма"]
export const QUESTION_FORMATS = ["Текст", "Число"]
const REQUIRED = "Это поле обязательно к заполнению"
const PRODUCT_TYPES = new Set(["Продукт", "Инвентарь", "Планограмма"])

export const emptyQuestion = (): SurveyQuestionDraft => ({
  text: "",
  type: "",
  maxAnswers: "",
  format: "",
  orderNo: "",
  required: false,
  answers: [""],
  balls: [""],
  checkAmount: false,
  checkPrice: false,
  isRival: false,
  products: [],
  rivalProducts: [],
  minimumQuantity: "",
  planogramId: "",
  fullyOutOfStock: false,
  allProductsHavePriceTag: false,
  requirePlanogramExistsInStore: false,
})
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

const PLUS = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
const MINUS = "M19 13H5v-2h14v2z"
const CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
const ADD_BOX = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
const DELETE = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"

function PlusMinus({ last, onClick, className = "" }: { last: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={last ? "+" : "−"} className={`flex shrink-0 items-center justify-center ${className}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
        <path d={last ? PLUS : MINUS} />
      </svg>
    </button>
  )
}

/** The reference's «Добавить продукт конкурента» dialog (the same fields as Продукты конкурентов). */
function RivalProductDialog({ competitors, onClose, onCreated }: { competitors: string[]; onClose: () => void; onCreated: (product: SurveyProduct) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({ name: "", competitor: "", create: false, newCompetitor: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const competitor = draft.create ? draft.newCompetitor.trim() : draft.competitor
  const valid = draft.name.trim() !== "" && (!draft.create || competitor !== "")

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/rival-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), competitor }),
      })
      const body = (await response.json().catch(() => null)) as (SurveyProduct & { error?: string }) | null
      if (!response.ok || !body || !body.id) throw new Error(body?.error || "Не удалось сохранить")
      onCreated({ id: Number(body.id), name: String(body.name ?? draft.name.trim()) })
    } catch (cause) {
      setError(t((cause as Error).message))
    } finally {
      setSaving(false)
    }
  }

  // The form is a full-screen layer (z 1400), so this dialog draws its own frame above it (the catalogue's Modal look).
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54]">
      <div role="dialog" aria-modal="true" aria-label={t("Добавить продукт конкурента")} className="w-[500px] max-w-full bg-white text-[13px] text-black shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[15px]">
          <h3 className="text-[13px] font-bold uppercase text-[#333]">{t("Добавить продукт конкурента")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </header>
        <div className="min-h-[252px] pb-[24px] pl-[30px] pr-[52px] pt-[24px]">
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[26px]">
            <LineSelect label={t("Конкурент")} value={draft.competitor} onChange={(value) => setDraft({ ...draft, competitor: value })} options={competitors} onClear={() => setDraft({ ...draft, competitor: "" })} />
          </div>
          <div className="mt-[32px]">
            <CheckBox checked={draft.create} onChange={(create) => setDraft({ ...draft, create })} label={t("Создать конкурент")} />
          </div>
          {draft.create && (
            <div className="mt-[14px]">
              <LineField label={t("Имя конкурента")} value={draft.newCompetitor} onChange={(newCompetitor) => setDraft({ ...draft, newCompetitor })} />
            </div>
          )}
          {error && <p className="mt-[12px] text-[12px] text-[#e5484d]">{error}</p>}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
          <SaveLink disabled={saving || !valid} onClick={() => void save()}>{t("Сохранить")}</SaveLink>
        </footer>
      </div>
    </div>
  )
}

type Catalog = { own: KitOption[]; inventory: KitOption[]; rival: KitOption[]; competitors: string[] }

/** «Список товаров» of a product question: pick a product, ✓ adds it (once), the list below with ✕ per row. */
function ProductList({
  question,
  catalog,
  onChange,
  onAddRival,
}: {
  question: SurveyQuestionDraft
  catalog: Catalog
  onChange: (partial: Partial<SurveyQuestionDraft>) => void
  onAddRival: () => void
}) {
  const { t } = useLanguage()
  const [picked, setPicked] = useState("")
  const [error, setError] = useState("")
  const rival = question.isRival
  const key = rival ? "rivalProducts" : "products"
  const list = question[key]
  const options = rival ? catalog.rival : question.type === "Продукт" ? catalog.own : catalog.inventory

  function add() {
    const option = options.find((item) => item.value === picked)
    if (!option) return
    const id = Number(option.value)
    if (list.some((item) => item.id === id)) {
      setError(t("Этот продукт уже существует"))
      return
    }
    onChange({ [key]: [{ id, name: option.label }, ...list] })
    setPicked("")
    setError("")
  }

  return (
    <div className="mt-[20px]">
      <div className="flex items-center">
        <div className="w-[250px]">
          <KitSearchSelect key={`${key}-${question.type}`} label={rival ? "Выберите продукт" : "Выберите продукт 1"} options={options} value={picked} onChange={setPicked} />
        </div>
        <button type="button" onClick={add} title={t("Применить")} aria-label={t("Применить")} className="ml-[20px] flex h-[48px] w-[48px] items-center justify-center rounded-full hover:bg-black/5">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
            <path d={CHECK} />
          </svg>
        </button>
        {rival && (
          <button type="button" onClick={onAddRival} title={t("Добавить продукт конкурента")} aria-label={t("Добавить продукт конкурента")} className="flex h-[48px] w-[48px] items-center justify-center rounded-full hover:bg-black/5">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
              <path d={ADD_BOX} />
            </svg>
          </button>
        )}
      </div>
      {error && <p className="mt-[5px] text-[12px] text-[#d32f2f]">{error}</p>}
      {list.length > 0 && (
        <div className="mt-[10px] text-[13px]">
          <div className="grid h-[40px] grid-cols-[1fr_11fr] items-center border-b border-dotted border-[#ccc] font-semibold">
            <span>ID</span>
            <span>{t("Наименование")}</span>
          </div>
          {list.map((item, index) => (
            <div key={item.id} className="grid h-[44px] grid-cols-[1fr_9fr_2fr] items-center border-b border-dotted border-[#ccc]">
              <span>№ {index + 1}</span>
              <span className="truncate">{item.name}</span>
              <button type="button" onClick={() => onChange({ [key]: list.filter((_, position) => position !== index) })} aria-label={t("Удалить")} className="flex h-[40px] w-[40px] items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
                  <path d={DELETE} />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [catalog, setCatalog] = useState<Catalog>({ own: [], inventory: [], rival: [], competitors: [] })
  const [rivalFor, setRivalFor] = useState<number | null>(null)
  const perfect = draft.flags.perfect
  const needsCatalog = draft.questions.some((question) => PRODUCT_TYPES.has(question.type))

  // The product lists load once a question needs them.
  useEffect(() => {
    if (!needsCatalog || catalog.own.length || catalog.rival.length) return
    let cancelled = false
    Promise.all([
      fetch("/api/products").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/rival-products").then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([products, rivals]: [unknown, unknown]) => {
        if (cancelled) return
        const own = (Array.isArray(products) ? products : []) as Array<{ id: number; name: string; deleted?: boolean; isInventory?: boolean }>
        const rivalRows = (Array.isArray(rivals) ? rivals : []) as Array<{ id: number; name: string; competitor?: string }>
        const live = own.filter((item) => !item.deleted)
        const option = (item: { id: number; name: string }): KitOption => ({ value: String(item.id), label: item.name })
        setCatalog({
          own: live.map(option),
          inventory: live.filter((item) => item.isInventory).map(option),
          rival: rivalRows.map(option),
          competitors: [...new Set(rivalRows.map((item) => item.competitor ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "en")),
        })
      })
      .catch(() => notify(t("Не удалось загрузить данные")))
    return () => {
      cancelled = true
    }
  }, [needsCatalog, catalog.own.length, catalog.rival.length, t])

  const patch = (partial: Partial<SurveyDraft>) => onChange({ ...draft, ...partial })
  const patchQuestion = (index: number, partial: Partial<SurveyQuestionDraft>) =>
    patch({ questions: draft.questions.map((question, i) => (i === index ? { ...question, ...partial } : question)) })

  function submit() {
    setSubmitted(true)
    const lines: string[] = []
    if (!draft.name.trim()) lines.push(`name: ${t(REQUIRED)}`)
    for (const question of draft.questions) {
      if (!question.text.trim()) lines.push(`name: ${t(REQUIRED)}`)
      if (question.type === "Вводит текст" || PRODUCT_TYPES.has(question.type)) continue
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
        <b className="text-[13px] font-bold uppercase tracking-[0.2px]">{title}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <X className="h-6 w-6" strokeWidth={1.5} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[480px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[30px] pb-[20px] pt-[24px]">
          <LineField label={t("Название")} value={draft.name} onChange={(value) => patch({ name: value })} />
          {submitted && !draft.name.trim() && <ErrorText show />}
          <div className="mt-[12px]">
            <LineField label={t("Порядковый номер")} value={draft.orderNo} onChange={(value) => patch({ orderNo: value })} />
          </div>
          <div className="mt-[27px]">
            <LineSelect label={t("Организация")} value={draft.organization} onChange={(value) => patch({ organization: value })} options={organizations} onClear={() => patch({ organization: "" })} />
          </div>
          <div className="mt-[22px]">
            <LineSelect label={t("Тип клиента")} value={draft.storeType} onChange={(value) => patch({ storeType: value })} options={clientTypes} />
          </div>
          <div className="mt-[12px] space-y-[10.5px]">
            <CheckBox checked={draft.flags.required} onChange={(value) => patch({ flags: { ...draft.flags, required: value } })} label={t("Обязательный")} />
            <CheckBox checked={draft.flags.storeCheck} onChange={(value) => patch({ flags: { ...draft.flags, storeCheck: value } })} label="Store Check" />
            <CheckBox checked={draft.active} onChange={(value) => patch({ active: value })} label={t("Активный")} />
            <CheckBox checked={draft.flags.scoring} onChange={(value) => patch({ flags: { ...draft.flags, scoring: value } })} label={t("Имеет систему оценки")} />
            <CheckBox
              checked={draft.flags.perfect}
              // A Perfect Store question without a type is a «Продукт» one (the reference sets it as soon as the box is ticked).
              onChange={(value) => patch({ flags: { ...draft.flags, perfect: value }, questions: value ? draft.questions.map((question) => (question.type ? question : { ...question, type: "Продукт" })) : draft.questions })}
              label="Perfect Store"
            />
          </div>
          <div className="mt-[22px]">
            <LineField label={t("Оставить комментарий...")} value={draft.comment} onChange={(value) => patch({ comment: value })} />
          </div>
        </aside>
        <main className="min-w-0 overflow-y-auto bg-[#f2f5f8] pb-[10px] pt-[10px]">
          <p className="px-[20px] text-[15px] font-semibold leading-[20px]">{t("Список вопросов")}</p>
          <div className="px-[20px] py-[10px]">
            {draft.questions.map((question, index) => {
              const last = index === draft.questions.length - 1
              const withList = question.type !== "Вводит текст"
              const productLike = PRODUCT_TYPES.has(question.type)
              return (
                <section key={index} className="relative mb-[20px] w-full bg-white p-[20px] shadow-[1px_0_14px_#ccc]">
                  <div className="flex h-[80px] items-center justify-between bg-[#f2f5f8] px-[20px]">
                    <b className="text-[20px] font-bold">{t("Вопрос")} № {index + 1}</b>
                    <PlusMinus
                      last={last}
                      onClick={() => (last ? patch({ questions: [...draft.questions, { ...emptyQuestion(), type: perfect ? "Продукт" : "" }] }) : patch({ questions: draft.questions.filter((_, i) => i !== index) }))}
                      className="h-[40px] w-[40px] rounded-[4px] bg-[#1E4A9A] text-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
                    />
                  </div>
                  <div className="grid gap-x-[25px]" style={{ gridTemplateColumns: withList ? "minmax(0,.7fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
                    <div className="py-[10px]">
                      <div className="pt-[3px]">
                        <LineField label={t("Напишите вопрос")} value={question.text} onChange={(value) => patchQuestion(index, { text: value })} />
                        <ErrorText show={submitted && !question.text.trim()} />
                      </div>
                      <div className="mt-[27px]">
                        <LineSelect
                          label={t("Тип")}
                          value={question.type}
                          onChange={(value) => patchQuestion(index, perfect ? { type: value, products: [] } : { type: value })}
                          onClear={perfect ? undefined : () => patchQuestion(index, { type: "" })}
                          options={perfect ? PERFECT_STORE_TYPES : QUESTION_TYPES}
                        />
                      </div>
                      {perfect ? (
                        <>
                          {question.type === "Инвентарь" && (
                            <div className="mt-[12px]">
                              <LineField label={t("Минимальное количество")} value={question.minimumQuantity} onChange={(value) => patchQuestion(index, { minimumQuantity: value })} />
                            </div>
                          )}
                          {question.type === "Планограмма" && (
                            <div className="mt-[12px]">
                              <LineField label={t("ID планограммы")} value={question.planogramId} onChange={(value) => patchQuestion(index, { planogramId: value })} />
                            </div>
                          )}
                          <div className="mt-[15px] space-y-[10.5px]">
                            {question.type === "Продукт" && (
                              <>
                                <CheckBox checked={question.fullyOutOfStock} onChange={(value) => patchQuestion(index, { fullyOutOfStock: value })} label={t("Не обязательно если отсутствует на складе")} />
                                <CheckBox checked={question.allProductsHavePriceTag} onChange={(value) => patchQuestion(index, { allProductsHavePriceTag: value })} label={t("На всех товарах должен быть ценник")} />
                              </>
                            )}
                            {question.type === "Планограмма" && (
                              <CheckBox checked={question.requirePlanogramExistsInStore} onChange={(value) => patchQuestion(index, { requirePlanogramExistsInStore: value })} label={t("Обязателен если имеется в наличии у магазина")} />
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {question.type !== "Продукт" && (
                            <>
                              <div className="mt-[12px]">
                                <LineField label={t("Максимум ответов")} value={question.maxAnswers} onChange={(value) => patchQuestion(index, { maxAnswers: value })} />
                              </div>
                              <div className="mt-[27px]">
                                <LineSelect label={t("Формат")} value={question.format} onChange={(value) => patchQuestion(index, { format: value })} onClear={() => patchQuestion(index, { format: "" })} options={QUESTION_FORMATS} />
                              </div>
                            </>
                          )}
                          <div className="mt-[12px]">
                            <LineField label={t("Порядковый номер")} value={question.orderNo} onChange={(value) => patchQuestion(index, { orderNo: value })} />
                          </div>
                          <div className="mt-[19px] space-y-[10.5px]">
                            {question.type !== "Продукт" ? (
                              <CheckBox checked={question.required} onChange={(value) => patchQuestion(index, { required: value })} label={t("Обязательный вопрос")} />
                            ) : (
                              <>
                                <CheckBox checked={question.checkAmount} onChange={(value) => patchQuestion(index, { checkAmount: value })} label="Face check" />
                                <CheckBox checked={question.checkPrice} onChange={(value) => patchQuestion(index, { checkPrice: value })} label="Price check" />
                                <CheckBox checked={question.isRival} onChange={(value) => patchQuestion(index, { isRival: value })} label={t("Продукт конкурента")} />
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {withList && (
                      <div className="h-[600px] overflow-y-scroll overflow-x-hidden py-[10px] pl-[10px] pr-[3px]">
                        <p className="text-[20px] font-bold leading-[28px]">{productLike ? t("Список товаров") : t("Ответы")}</p>
                        {productLike ? (
                          <ProductList question={question} catalog={catalog} onChange={(partial) => patchQuestion(index, partial)} onAddRival={() => setRivalFor(index)} />
                        ) : (
                          <div className="mt-[15px]">
                            {question.answers.map((answer, answerIndex) => {
                              const answerLast = answerIndex === question.answers.length - 1
                              const ball = question.balls[answerIndex] ?? ""
                              return (
                                <div key={answerIndex} className="mb-[15px] flex items-center bg-white px-[20px] py-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.16)]">
                                  <div className="mr-[10px] w-full pt-[7px]">
                                    <LineField
                                      label={`${t("Ответ")} #${answerIndex + 1}`}
                                      value={answer}
                                      onChange={(value) => patchQuestion(index, { answers: question.answers.map((item, i) => (i === answerIndex ? value : item)) })}
                                    />
                                    {draft.flags.scoring && (
                                      <div className="mt-[7px] w-1/4">
                                        <LineField
                                          label={t("Оценка")}
                                          value={ball}
                                          onChange={(value) =>
                                            patchQuestion(index, { balls: question.answers.map((_, i) => (i === answerIndex ? value.replace(/[^\d.,-]/g, "") : (question.balls[i] ?? ""))) })
                                          }
                                        />
                                      </div>
                                    )}
                                  </div>
                                  <PlusMinus
                                    last={answerLast}
                                    onClick={() =>
                                      answerLast
                                        ? patchQuestion(index, { answers: [...question.answers, ""], balls: [...question.answers.map((_, i) => question.balls[i] ?? ""), ""] })
                                        : patchQuestion(index, {
                                            answers: question.answers.filter((_, i) => i !== answerIndex),
                                            balls: question.answers.map((_, i) => question.balls[i] ?? "").filter((_, i) => i !== answerIndex),
                                          })
                                    }
                                    className="h-[40px] w-[40px] text-[#222]"
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
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
      {rivalFor !== null && (
        <RivalProductDialog
          competitors={catalog.competitors}
          onClose={() => setRivalFor(null)}
          onCreated={(product) => {
            const question = draft.questions[rivalFor]
            setCatalog((current) => ({ ...current, rival: [...current.rival, { value: String(product.id), label: product.name }] }))
            if (question && !question.rivalProducts.some((item) => item.id === product.id)) patchQuestion(rivalFor, { rivalProducts: [product, ...question.rivalProducts] })
            setRivalFor(null)
          }}
        />
      )}
      {alertLines && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54]" onClick={() => setAlertLines(null)}>
          <div onClick={(event) => event.stopPropagation()} className="flex h-[300px] w-[400px] flex-col items-center bg-white px-[15px] pb-[20px] pt-[24px] shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
            <span className="flex h-[48px] w-[48px] items-center justify-center rounded-full border-[3px] border-[#1E4A9A] text-[26px] font-bold leading-none text-[#1E4A9A]">!</span>
            <div className="mt-[16px] flex-1 text-center text-[15px] leading-[19px]">
              {alertLines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
            <button type="button" onClick={() => setAlertLines(null)} className="h-[40px] w-full rounded-[3px] bg-[#1E4A9A] text-[13px] font-bold text-white">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
