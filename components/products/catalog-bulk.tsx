"use client"

import { useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { CheckField, SelectField, TextField, Toggle } from "@/components/products/catalog-form-ui"
import { KIND_TEXT, catalogMutate, errorText } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, leadingNumber, type CatalogBulkChanges, type CatalogKind, type CatalogOptions } from "@/lib/products-types"

// Checkbox actions of the list: "Изменить выбранные продукты" (demo ProductMultiUpdate,
// module 2225 — every block is "Изменить …" + its value) and "Добавить лимит"
// ("Добавление лимита", module 2224: Кол-во, Агенты). Dialogs follow the reference's look.

type TextKey = "type" | "unit" | "brand" | "organization" | "supplier" | "color"
type FlagKey = "canSell" | "showInBot" | "isMml" | "manualDiscount" | "hideFromAgent"

export function BulkEditDialog({
  kind,
  ids,
  options,
  onClose,
  onSaved,
}: {
  kind: CatalogKind
  ids: number[]
  options: CatalogOptions | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [text, setText] = useState<Record<TextKey, string>>({ type: "", unit: "", brand: "", organization: "", supplier: "", color: "" })
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>({ canSell: true, showInBot: true, isMml: false, manualDiscount: false, hideFromAgent: false })
  const [deleted, setDeleted] = useState("Удалить")
  // "Переместить в раздел": the toggle is the target section (a product list offers "Сырье" first, as the reference does).
  const [moveToRaw, setMoveToRaw] = useState(kind === "product")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const toggle = (key: string) => setEnabled((current) => ({ ...current, [key]: !current[key] }))

  const block = (key: string, label: string, body: ReactNode) => (
    <div key={key}>
      <div className="flex h-10 items-center">
        <CheckField label={t(label)} checked={Boolean(enabled[key])} onChange={() => toggle(key)} />
      </div>
      {enabled[key] && <div className="mb-2 mt-[11px]">{body}</div>}
    </div>
  )
  const textBlock = (key: TextKey, label: string, field: string, list: string[]) =>
    block(
      key,
      label,
      <SelectField label={t(field)} value={text[key]} options={list} onChange={(value) => setText((current) => ({ ...current, [key]: value }))} />,
    )
  const flagBlock = (key: FlagKey, label: string, title: string, subTitle?: string) =>
    block(
      key,
      label,
      <Toggle checked={flags[key]} onChange={(value) => setFlags((current) => ({ ...current, [key]: value }))} title={t(title)} subTitle={subTitle ? t(subTitle) : undefined} />,
    )

  const save = async () => {
    const changes: CatalogBulkChanges = {}
    for (const key of Object.keys(text) as TextKey[]) if (enabled[key]) changes[key] = text[key].trim()
    for (const key of Object.keys(flags) as FlagKey[]) if (enabled[key]) changes[key] = flags[key]
    if (enabled.deleted) changes.deleted = deleted === "Удалить"
    if (enabled.move) changes.moveTo = moveToRaw ? "raw_material" : "product"
    if (enabled.unit && !changes.unit) return setError(t("Обязательное поле"))
    if (!Object.keys(changes).length) return setError(t("Ничего не выбрано"))
    setBusy(true)
    setError("")
    const result = await catalogMutate("POST", `${CATALOG_API[kind]}/bulk`, { ids, changes })
    setBusy(false)
    if (!result.ok) return setError(errorText(result, t))
    onSaved()
  }

  return (
    <Modal
      title={t(KIND_TEXT[kind].multiTitle)}
      onClose={onClose}
      bodyClassName="max-h-[calc(100vh-117px)] overflow-y-auto px-[30px] py-5"
      footer={
        <>
          {error && <span className="mr-auto pl-[30px] text-[13px] text-[#f44336]">{error}</span>}
          <SaveLink disabled={busy} onClick={() => void save()}>
            {t(kind === "product" ? "Изменить продукты" : "Изменить сырье")}
          </SaveLink>
        </>
      }
    >
      {textBlock(
        "type",
        "Изменить тип продукта",
        "Тип продукта",
        (options?.types ?? []).map((type) => type.name),
      )}
      {textBlock("unit", "Изменить мера", "Мера", options?.units ?? [])}
      {textBlock("brand", "Изменить бренд", "Бренд", options?.brands ?? [])}
      {flagBlock("showInBot", "Изменить показать в боте", "Показывать в боте", "Показывать в телеграм боте")}
      {flagBlock("canSell", "Изменить можно продавать", "Можно продавать", "Агенты могут продать этот товар")}
      {textBlock("organization", "Изменить организацию", "Организация", options?.organizations ?? [])}
      {textBlock("color", "Изменить цвет", "Цвет", options?.colors ?? [])}
      {textBlock("supplier", "Изменить поставщик", "Поставщик", options?.suppliers ?? [])}
      {flagBlock("isMml", "Изменить ММЛ продукт", "ММЛ продукт")}
      {block("move", "Переместить в раздел (Сырье/Продукт)", <Toggle checked={moveToRaw} onChange={setMoveToRaw} title={t(moveToRaw ? 'Переместить в раздел "Сырье"' : 'Переместить в раздел "Продукты"')} />)}
      {block("deleted", "Изменить удалённые", <SelectField label={t("Изменить удалённые")} value={deleted} options={["Удалить", "Восстановить"].map((value) => t(value))} onChange={(value) => setDeleted(value === t("Восстановить") ? "Восстановить" : "Удалить")} />)}
      {flagBlock("manualDiscount", "Изменить статус ручной скидки", "Можно дать ручную скидку")}
      {flagBlock("hideFromAgent", "Изменить скрытие из списка заказов для агента", "Скрыть из списка заказов для агента")}
    </Modal>
  )
}

/** Multi pick of the agents: chosen names as chips, the list below the underline. */
function AgentsField({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div onClick={() => setOpen((current) => !current)} className={`relative min-h-9 cursor-pointer border-b border-[#e8e8e8] ${value.length ? "pt-[14px]" : ""}`}>
        <span className={`pointer-events-none absolute left-0 font-semibold text-black ${value.length ? "top-[-6px] text-[10px] leading-4" : "top-[13px] text-[13px] leading-4"}`}>{label}</span>
        <div className="flex flex-wrap gap-1 pb-1">
          {value.map((name) => (
            <span key={name} className="flex h-6 items-center bg-[#3f51b5] px-2 text-[13px] text-white" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label="×" className="mr-2" onClick={() => onChange(value.filter((item) => item !== name))}>
                ×
              </button>
              {name}
            </span>
          ))}
        </div>
        <span className="pointer-events-none absolute right-[10px] top-[17px] border-x-[5px] border-t-[5px] border-x-transparent border-t-[#999]" />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {options.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name])}
              className={`block h-8 w-full truncate px-[10px] text-left text-[13px] font-semibold leading-8 ${value.includes(name) ? "bg-[#e6f2ff] text-black" : "text-[#666] hover:bg-[#e6f2ff]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddLimitDialog({
  kind,
  ids,
  options,
  onClose,
  onSaved,
}: {
  kind: CatalogKind
  ids: number[]
  options: CatalogOptions | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState("")
  const [agents, setAgents] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    if (!amount.trim()) return setError(t("Укажите количество"))
    if (!agents.length) return setError(t("Выберите агентов"))
    setBusy(true)
    setError("")
    const result = await catalogMutate("POST", `${CATALOG_API[kind]}/limits`, { ids, agents, amount: leadingNumber(amount) })
    setBusy(false)
    if (!result.ok) return setError(errorText(result, t))
    onSaved()
  }

  // The reference's dialog: 400px, fields without side padding, a footer band wider than the card.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="relative w-[400px] max-w-full bg-white text-[13px] text-[#333]">
        <header className="flex h-[59px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[19px]">
          <h3 className="text-[15px] font-bold uppercase">{t("Добавление лимита")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-6 w-6 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>
        <div className="min-h-[214px]">
          <TextField label={t("Кол-во")} numeric value={amount} onChange={setAmount} className="-mt-[7px]" />
          <div className="mt-[30px]">
            <AgentsField label={t("Агенты")} options={options?.agents ?? []} value={agents} onChange={setAgents} />
          </div>
        </div>
        <footer className="relative -mx-[30px] flex h-[57px] w-[460px] items-center bg-white pl-[10px]">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="h-9 w-[111px] rounded-[2px] bg-[#71ce87] text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60"
          >
            {t("Сохранить")}
          </button>
          {error && <span className="ml-4 text-[13px] text-[#f44336]">{error}</span>}
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** "Отправить продукты": the reference's confirm dialog (title = the action, the request text, then the ids). */
export function SendProductsDialog({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: (sent: number) => void }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const send = async () => {
    setBusy(true)
    setError("")
    const result = await catalogMutate("POST", "/api/products/sync-linko", { ids })
    setBusy(false)
    if (!result.ok) return setError(errorText(result, t))
    onSaved((result.data as { sent?: number } | undefined)?.sent ?? ids.length)
  }

  return (
    <Modal
      title={t("Отправить продукты")}
      onClose={onClose}
      bodyClassName="h-[210px]"
      footer={
        <>
          {error && <span className="mr-auto pl-[30px] text-[13px] text-[#f44336]">{error}</span>}
          <button type="button" disabled={busy} onClick={() => void send()} className="mr-[34px] text-[12px] font-bold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-40">
            {t("Да")}
          </button>
        </>
      }
    >
      <p className="px-[30px] pt-[19px] text-[13px] leading-5">{t("Подтверждение запроса")}</p>
      <div className="mt-[19px] flex h-[55px] items-center bg-[#f2f5f8] px-[30px] text-[13px] font-semibold">{`${t("Выбранные продукты")}: ${ids.join(", ")}`}</div>
    </Modal>
  )
}
