"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from "react"
import { Trash2, X } from "lucide-react"

import { SearchSelect, useCanManage } from "@/components/analytics/cash-management-shared"

import { useLanguage } from "@/lib/i18n/language-context"
import {
  api,
  ApiError,
  Field,
  formatAmount,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  FIELD_REQUIRED,
  ItemLinesEditor,
  ItemPicker,
  Modal,
  PHOTO_TYPES,
  PRODUCTION_WRITE,
  QUANTITY_ERROR,
  readPhotoFile,
  readQuantity,
  SaveButton,
  STATUS_LABELS,
  STATUS_TEXT,
  STATUS_TRANSITIONS,
  todayIso,
  useApiData,
  validQuantity,
  type CatalogItem,
  type DraftLine,
  type PartyStatus,
  type Stage,
  type StockItem,
} from "./production-ui"
import { notify } from "@/lib/notify"

type Movement = {
  id: number
  key: string
  name: string
  unit: string
  amount: number
  cost: number
  total: number
  isDefect: boolean
  comment: string
  image: string
  createdAt: string
  /** Made lines: the series / expiry date the output carries («Срок годности»), '' without one. */
  series?: string
}
type SummaryLine = { key: string; name: string; unit: string; amount: number; cost: number; total: number; series?: string }
export type PartyDetail = {
  id: number
  stageId: number | null
  stageName: string
  warehouse: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
  made: Movement[]
  raw: Movement[]
  madeDefects: Movement[]
  rawDefects: Movement[]
  totalMade: SummaryLine[]
  totalRaw: SummaryLine[]
  totalRawCost: number
  /** false: the reader may not see what the goods cost (lib/production-api.ts withCostVisibility), and every cost
   * figure above is null. Absent (the write answers, which go to production writers only) = true. */
  canSeeCost?: boolean
}
type RecipeComponent = { id: number; role: "raw" | "ready"; key: string; name: string; unit: string; amount: number }
export type Recipe = CatalogItem & { itemId: number; amount: number; equipmentName: string; equipmentId: number | null; components: RecipeComponent[] }

type Dialog = "auto" | "defect" | "raw" | "made" | "edit" | null
type Tab = "summary" | "made" | "raw" | "defects"

const TABS: Array<[Tab, string]> = [
  ["summary", "Итоги производства"],
  ["made", "Произведенные продукты"],
  ["raw", "Сырье"],
  ["defects", "Брак"],
]

// The open tab, an open dialog and the photo being viewed live in the URL, as the reference keeps them
// (?detailTab=…, ?open…Dialog=true, ?openImagesDialog=<line>): a reload or a shared link reopens them, and the
// open tab stays when another batch is opened.
const TAB_PARAM = "detailTab"
const TAB_VALUES: Record<Tab, string> = { summary: "productList", made: "product", raw: "manafacture", defects: "logs" }
const DIALOG_PARAMS: Record<Exclude<Dialog, null>, string> = {
  auto: "openAutoAddDialog",
  defect: "openAddMarriageDialog",
  raw: "openAddRawDialog",
  made: "openAddProductsDialog",
  edit: "openUpdateDialog",
}
const VIEWER_PARAM = "openImagesDialog"

const urlParam = (name: string) => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name))

/** Sets / removes query parameters of the current history entry; the page's other parameters stay. */
function setUrlParams(changes: Record<string, string | null>) {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
  }
  if (url.href !== window.location.href) window.history.replaceState(null, "", url)
}

const tabFromUrl = (): Tab => (Object.entries(TAB_VALUES).find(([, value]) => value === urlParam(TAB_PARAM))?.[0] as Tab | undefined) ?? "summary"
const dialogFromUrl = (): Dialog => (Object.entries(DIALOG_PARAMS).find(([, name]) => urlParam(name) === "true")?.[0] as Dialog | undefined) ?? null
function viewerFromUrl(): number | null {
  const value = Number(urlParam(VIEWER_PARAM))
  return Number.isInteger(value) && value > 0 ? value : null
}
/** The dialog and viewer flags of a batch (they go when the batch is left). */
const BATCH_FLAGS = [...Object.values(DIALOG_PARAMS), VIEWER_PARAM]

/** Material "remove_shopping_cart": the reference's «Добавить бракованный товар» icon. */
const REMOVE_SHOPPING_CART =
  "M22.73 22.73L2.77 2.77 2 2l-.73-.73L0 2.54l4.39 4.39 2.21 4.66-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h7.46l1.38 1.38c-.5.36-.83.95-.83 1.62 0 1.1.89 2 1.99 2 .67 0 1.26-.33 1.62-.84L21.46 24l1.27-1.27zM7.42 15c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h2.36l2 2H7.42zm8.13-2c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H6.54l9.01 9zM7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2z"
const PHOTO_ICON = "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"

const NO_RECIPES: Recipe[] = []
const NO_STOCK: StockItem[] = []

/** The batch dialogs' item lists, as the reference serves them (stock/all_balances?party=…&manufacture_type=raw|made):
 * - raw: the raw materials of the stage's product norms, each once, in the norms' order;
 * - made: the stage's products;
 *   both with their stock in the stage warehouse (an item no longer in the catalog is not offered);
 * - products: every catalog product, the stage's own first (a defective product may be any product, as there). */
function batchOptions(recipes: Recipe[], stock: StockItem[]): { raw: StockItem[]; made: StockItem[]; products: StockItem[] } {
  const byKey = new Map(stock.map((item) => [item.key, item]))
  const seen = new Set<string>()
  const raw: StockItem[] = []
  for (const recipe of recipes) {
    for (const component of recipe.components) {
      if (component.role !== "raw" || seen.has(component.key)) continue
      seen.add(component.key)
      const item = byKey.get(component.key)
      if (item) raw.push(item)
    }
  }
  const made = recipes.flatMap((recipe) => byKey.get(recipe.key) ?? [])
  const stageProducts = new Set(made.map((item) => item.key))
  return { raw, made, products: [...made.filter((item) => item.kind === "product"), ...stock.filter((item) => item.kind === "product" && !stageProducts.has(item.key))] }
}

type BatchDetailProps = {
  partyId: number
  stages: Stage[]
  onChanged: () => void
  /** Collapses the detail into the list (a click on its header strip, as in the reference). Without it the detail
   * drops ?party from the URL itself and tells the list through a popstate event. */
  onClose?: () => void
}

/** A fresh card for every batch: nothing of the previous one (its figures, an open dialog and its unsaved values)
 * is shown, or saved into the next one, while the next one loads. */
export function BatchDetail(props: BatchDetailProps) {
  return <BatchCard key={props.partyId} {...props} />
}

function BatchCard({ partyId, stages, onChanged, onClose }: BatchDetailProps) {
  const { t, language } = useLanguage()
  const { data: party, setData: setParty, error } = useApiData<PartyDetail | null>(`/api/production/parties/${partyId}`, null, { quiet: true })
  const [tab, setTab] = useState<Tab>(tabFromUrl)
  const [dialog, setDialog] = useState<Dialog>(dialogFromUrl)
  const [viewer, setViewer] = useState<number | null>(viewerFromUrl)
  const stageId = party?.stageId ?? null
  const pending = party?.status === "pending"
  // Only a production writer sees the write controls and their dialogs (the server refuses anyone else with 403).
  // The answer of /api/auth/me comes later than the batch may: until then canWrite is false for a writer too, so it
  // gates what is drawn only, never `shown` or the URL (a writer's ?open…Dialog=true is kept and opens once known).
  const canWrite = useCanManage(PRODUCTION_WRITE)
  // A link may carry a dialog this batch no longer offers: only «Изменить» opens once it is not in progress.
  const shown: Dialog = dialog === "edit" || (dialog !== null && pending) ? dialog : null
  const rendered: Dialog = canWrite ? shown : null
  const needsOptions = rendered === "auto" || rendered === "defect" || rendered === "raw" || rendered === "made"
  const { data: recipes, loading: recipesLoading } = useApiData<Recipe[]>(needsOptions && stageId ? `/api/production/recipes?stageId=${stageId}` : null, NO_RECIPES)
  const { data: stock, loading: stockLoading } = useApiData<StockItem[]>(needsOptions && stageId ? `/api/production/items?stageId=${stageId}` : null, NO_STOCK)
  // Until both lists are here (still the initial empty lists), the dialogs say «Загрузка...», not «Не найдено» or «У
  // этапа нет продуктов».
  const optionsLoading = stageId !== null && (recipesLoading || stockLoading || recipes === NO_RECIPES || stock === NO_STOCK)
  const options = useMemo(() => batchOptions(recipes, stock), [recipes, stock])
  const handled = useRef(false)

  const close = useCallback(
    (replace = false) => {
      if (onClose) {
        onClose()
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete("party")
      if (replace) window.history.replaceState(null, "", url)
      else window.history.pushState(null, "", url)
      // The list follows ?party through its popstate listener (the router ignores an event without state).
      window.dispatchEvent(new PopStateEvent("popstate"))
    },
    [onClose],
  )

  useEffect(() => {
    if (!error || handled.current) return
    handled.current = true
    // An unknown batch (a stale link): like the reference, the page just shows the list, without a notice or an endless loader.
    if (error.status === 404) close(true)
    else notify(error.message)
  }, [error, close])

  // Once the batch is here: a dialog it does not offer, or a photo that is not one of its lines, is dropped.
  useEffect(() => {
    if (!party) return
    if (dialog !== shown) setDialog(shown)
    if (viewer !== null && ![...party.madeDefects, ...party.rawDefects].some((row) => row.id === viewer && row.image)) setViewer(null)
  }, [party, dialog, shown, viewer])

  useEffect(() => {
    setUrlParams({
      // Like the reference, the URL names the tab once one was chosen.
      ...(tab !== "summary" || urlParam(TAB_PARAM) !== null ? { [TAB_PARAM]: TAB_VALUES[tab] } : {}),
      ...Object.fromEntries(Object.entries(DIALOG_PARAMS).map(([name, param]) => [param, dialog === name ? "true" : null])),
      [VIEWER_PARAM]: viewer === null ? null : String(viewer),
    })
  }, [tab, dialog, viewer])

  useEffect(
    () => () => {
      // Leaving this batch: its dialog and photo go; the tab stays for the next batch unless the detail closed.
      const open = urlParam("party") !== null
      setUrlParams(Object.fromEntries([...BATCH_FLAGS, ...(open ? [] : [TAB_PARAM])].map((name) => [name, null])))
    },
    [],
  )

  if (error && !party) return null
  if (!party) return <div className="bg-white p-10 text-center text-slate-400 shadow-lg">{t("Загрузка...")}</div>

  const updated = (detail: PartyDetail) => {
    setParty(detail)
    setDialog(null)
    onChanged()
  }

  async function removeMovement(id: number) {
    if (!(await askDelete())) return
    try {
      await api(`/api/production/movements/${id}`, { method: "DELETE" })
      setParty(await api<PartyDetail>(`/api/production/parties/${partyId}`))
      onChanged()
    } catch (error) {
      notify((error as Error).message)
    }
  }

  const photo = viewer === null ? undefined : [...party.madeDefects, ...party.rawDefects].find((row) => row.id === viewer && row.image)
  // A reader who may not see costs gets them as null: the Себестоимость / Сумма columns and the Итого rows go.
  const money = party.canSeeCost !== false
  const costCells = (...cells: string[]) => (money ? cells : [])
  // The reference's desktop widths; each column gives way to its floor on a narrower card (see `columns`).
  const MADE_SUMMARY = money ? columns([200, 436], [110, 218], [110, 218]) : columns([200, 436], [110, 218])
  const RAW_SUMMARY = money ? MADE_SUMMARY : columns([200, 436])
  const PLAIN = money ? columns([200, 454], [110, 182], [110, 182]) : columns([200, 454], [110, 182])
  const RAW = money ? columns([180, 363], [110, 273], [110, 182]) : columns([180, 363])
  const deletable = pending && canWrite
  const deleteColumn = deletable ? DELETE_COLUMN : 0
  return (
    <div className="mx-[-15px] my-5 bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      {/* Like the reference, the whole header strip collapses the detail into the list; its buttons keep their own action.
          One 66 px row where it fits (the reference's); on a narrower card (a tablet, longer labels in another
          language) the action buttons wrap under the title instead of widening the page. On a phone the pencil
          stays beside the title and the four actions fill the width below it (one per row on a narrow phone). */}
      <div
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) close()
        }}
        className="relative flex min-h-[66px] cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[#efefef] py-2 pl-[30px] pr-[6px] max-md:pl-4"
      >
        <h3 className={`text-[18px] font-semibold max-md:py-[10px] max-md:leading-[28px] ${canWrite ? "max-md:pr-12" : ""}`}>
          № {party.id} <span className={STATUS_TEXT[party.status]}>{t(STATUS_LABELS[party.status])}</span>
        </h3>
        <div className={`ml-auto flex min-w-0 flex-wrap items-center justify-end gap-[10px] ${pending && canWrite ? "max-md:grid max-md:w-full max-md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] max-md:gap-2" : ""}`}>
          {pending && canWrite && (
            <>
              <ActionButton color="bg-[#4f71dc]" icon="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" label="Автодобавление" onClick={() => setDialog("auto")} />
              <ActionButton color="bg-[#ff8a65]" icon={REMOVE_SHOPPING_CART} label="Добавить бракованный товар" onClick={() => setDialog("defect")} />
              <ActionButton color="bg-[#4db6ac]" icon="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" label="Добавить сырье" onClick={() => setDialog("raw")} />
              <ActionButton color="bg-[#4f71dc]" icon="M10 17l5-5-5-5v10zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" label="Добавить продукт" onClick={() => setDialog("made")} />
            </>
          )}
          {canWrite && (
            <button onClick={() => setDialog("edit")} aria-label={t("Изменить")} className="-ml-[10px] flex h-12 w-12 items-center justify-center max-md:absolute max-md:right-[6px] max-md:top-2 max-md:ml-0">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[320px_minmax(0,1fr)]">
        <aside>
          <dl className="border-b border-[#efefef] px-[30px] pb-[18px] pt-[15px]">
            <InfoRow label="Дата создания" value={formatDateTime(party.createdAt, language)} />
            <InfoRow label="Дата завершения" value={party.finishedAt ? formatDateTime(party.finishedAt, language) : t("Не указано")} />
            <InfoRow label="Дата партии" value={formatDate(party.date, language)} />
            <InfoRow label="Пользователь" value={party.userName} raw />
            <InfoRow label="Этап производства" value={party.stageName} raw />
          </dl>
          <div className="px-[30px] py-[20px]">
            <p className="font-semibold">{t("Комментарий")}:</p>
            <p className="mt-[5px] whitespace-pre-wrap">{party.comment ? <span data-no-translate>{party.comment}</span> : t("Комментарий отсутствует")}</p>
          </div>
        </aside>

        <section className="min-w-0 px-3 pb-[20px] md:pl-[22px] md:pr-[40px]">
          {/* Below md the four tabs are a row that scrolls (the active one underlined), instead of overlapping. */}
          <nav className="relative ml-[8px] mr-[10px] grid h-[50px] grid-cols-4 max-md:flex max-md:overflow-x-auto">
            {TABS.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`text-center text-[13px] max-md:shrink-0 max-md:whitespace-nowrap max-md:border-b-2 max-md:px-3 ${tab === value ? "max-md:border-[#1E4A9A]" : "max-md:border-transparent"}`}
              >
                {t(label)}
              </button>
            ))}
            <span className="absolute bottom-0 hidden h-[2px] bg-[#1E4A9A] transition-transform duration-300 md:block" style={{ width: "25%", transform: `translateX(${TABS.findIndex(([value]) => value === tab) * 100}%)` }} />
          </nav>
          {tab === "summary" && (
            <TableScroll min={Math.max(MADE_SUMMARY.min, RAW_SUMMARY.min)}>
              <LinesTable
                cols={MADE_SUMMARY.template}
                headers={["Произведенные товары", "Кол-во", ...costCells("Себестоимость"), "Срок годности"]}
                rows={party.totalMade.map((line) => [line.name, formatAmount(line.amount, line.unit), ...costCells(formatNumber(line.cost)), line.series || "-"])}
              />
              <LinesTable
                cols={RAW_SUMMARY.template}
                headers={["Затраченное сырье", "Кол-во", ...costCells("Себестоимость", "Сумма")]}
                rows={party.totalRaw.map((line) => [line.name, formatAmount(line.amount, line.unit), ...costCells(formatNumber(line.cost), formatNumber(line.total))])}
              />
              {money && <TotalRow cols={MADE_SUMMARY.template} value={party.totalRawCost} />}
            </TableScroll>
          )}
          {tab === "made" && (
            <TableScroll min={PLAIN.min + deleteColumn}>
              <LinesTable
                cols={PLAIN.template}
                loose
                headers={["Товар", "Кол-во", ...costCells("Себестоимость"), "Срок годности"]}
                rows={party.made.map((row) => [row.name, formatAmount(row.amount, row.unit), ...costCells(formatNumber(row.cost)), row.series || "-"])}
                onDelete={deletable ? party.made.map((row) => () => removeMovement(row.id)) : undefined}
              />
            </TableScroll>
          )}
          {tab === "raw" && (
            <TableScroll min={RAW.min + deleteColumn}>
              <LinesTable
                cols={RAW.template}
                loose
                headers={["Товар", "Кол-во", ...costCells("Себестоимость", "Сумма")]}
                rows={party.raw.map((row) => [row.name, formatAmount(row.amount, row.unit), ...costCells(formatNumber(row.cost), formatNumber(row.total))])}
                onDelete={deletable ? party.raw.map((row) => () => removeMovement(row.id)) : undefined}
              />
              {/* The batch's total, the same figure as on «Итоги производства» (as the reference shows it on both tabs).
                  It takes the table's very grid (the delete track too), so «Итого» stays under «Сумма» at every width. */}
              {money && <TotalRow cols={RAW.template} trailing={deletable} value={party.totalRawCost} />}
            </TableScroll>
          )}
          {tab === "defects" && (
            <TableScroll min={DEFECT_COLUMNS.min + deleteColumn}>
              <DefectTable title="Бракованный товар" rows={party.madeDefects} onDelete={deletable ? removeMovement : undefined} onPhoto={(row) => setViewer(row.id)} />
              <DefectTable title="Бракованное сырье" rows={party.rawDefects} onDelete={deletable ? removeMovement : undefined} onPhoto={(row) => setViewer(row.id)} />
            </TableScroll>
          )}
        </section>
      </div>

      {rendered === "auto" && <AutoAddDialog party={party} recipes={recipes} stock={stock} loading={optionsLoading} onClose={() => setDialog(null)} onSaved={updated} />}
      {rendered === "defect" && <DefectDialog party={party} products={options.products} loading={optionsLoading} onClose={() => setDialog(null)} onSaved={updated} />}
      {(rendered === "raw" || rendered === "made") && (
        <ItemsDialog
          party={party}
          direction={rendered}
          items={rendered === "raw" ? options.raw : options.made}
          loading={optionsLoading}
          stageHasProducts={recipes.length > 0}
          onClose={() => setDialog(null)}
          onSaved={updated}
        />
      )}
      {rendered === "edit" && (
        <EditDialog
          party={party}
          stages={stages}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            updated(await api<PartyDetail>(`/api/production/parties/${partyId}`))
          }}
        />
      )}
      {photo && <PhotoViewer src={photo.image} alt={photo.name} onClose={() => setViewer(null)} />}
    </div>
  )
}

function ActionButton({ color, icon, label, onClick }: { color: string; icon: string; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick} className={`flex min-h-[36px] items-center rounded-[3px] px-4 text-left text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95 max-md:py-[6px] ${color}`}>
      <svg viewBox="0 0 24 24" className="mr-[10px] h-6 w-6 shrink-0 fill-white" aria-hidden><path d={icon} /></svg>
      {t(label)}
    </button>
  )
}

/** `raw`: the value is stored data (a user's or a stage's name), which the page translator must leave alone. */
function InfoRow({ label, value, raw }: { label: string; value: string; raw?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="flex min-h-[25px] flex-wrap items-center justify-between leading-[16px]">
      <dt className="mr-3 whitespace-nowrap">{t(label)}</dt>
      <dd className="font-semibold" {...(raw ? { "data-no-translate": "" } : {})}>
        {value}
      </dd>
    </div>
  )
}

const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
/** A line row: like the reference, it is highlighted on hover and reveals its delete button then. */
const ROW = `group relative grid items-center transition-colors hover:bg-[#f2f5f8] ${DOTTED}`

/** The row's delete button: hidden until the row is hovered or the button focused (always shown on touch screens). */
function DeleteButton({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("Удалить")}
      className="flex h-8 w-8 items-center justify-center justify-self-end opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Trash2 className="h-4 w-4 text-[#5d6474]" />
    </button>
  )
}

/** A lines table's columns: each given as [floor, the reference's width] in px, the last one taking the rest (at least
 * `REST_FLOOR`). Where the card is wide enough (the reference's desktop) the columns are exactly the reference's; on a
 * narrower card every column gives way down to its floor (the grid shares the shortage among them) instead of the row
 * running past the card's edge; below the floors' sum (`min`) the table scrolls inside the card. */
type Columns = { template: string; min: number }
const REST_FLOOR = 140
const DELETE_COLUMN = 40
function columns(...tracks: Array<[floor: number, width: number]>): Columns {
  return {
    template: [...tracks.map(([floor, width]) => `minmax(${floor}px,${width}px)`), `minmax(${REST_FLOOR}px,1fr)`].join(" "),
    min: tracks.reduce((sum, [floor]) => sum + floor, REST_FLOOR),
  }
}

/** A tab's tables at least `min` px wide (phones: at least 760 px, as before): narrower, they scroll inside the card
 * instead of widening the page (a phone, a tablet, a laptop beside the 320 px info column). */
function TableScroll({ min, children }: { min: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[var(--table-min)] max-md:min-w-[max(760px,var(--table-min))]" style={{ "--table-min": `${min}px` } as CSSProperties}>
        {children}
      </div>
    </div>
  )
}

/** `loose`: the reference's single-list tabs (Произведенные продукты / Сырье) use 60px rows and indent the cells. */
function LinesTable({ headers, rows, onDelete, cols, loose }: { headers: string[]; rows: string[][]; onDelete?: Array<() => void>; cols: string; loose?: boolean }) {
  const { t } = useLanguage()
  const grid = onDelete ? `${cols} ${DELETE_COLUMN}px` : cols
  return (
    <div>
      <div className={`relative grid h-[56px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
        {headers.map((header) => <div key={header} className={`break-words ${loose ? "pl-2" : ""}`}>{t(header)}</div>)}
        {onDelete && <div />}
      </div>
      {rows.map((row, index) => (
        <div key={index} className={`${ROW} ${loose ? "min-h-[60px]" : "min-h-[50px]"}`} style={{ gridTemplateColumns: grid }}>
          {row.map((cell, cellIndex) => (
            <div key={cellIndex} data-no-translate className={`break-words ${loose ? "pl-[13px]" : ""}`}>
              {cell}
            </div>
          ))}
          {onDelete && <DeleteButton onClick={onDelete[index]} />}
        </div>
      ))}
    </div>
  )
}

/** `trailing`: the table above has the 40 px delete track (LinesTable with onDelete). The total row must have the
 * same tracks, or the shrinking columns share the card's width differently and «Итого» drifts off «Сумма». */
function TotalRow({ value, cols, trailing }: { value: number; cols: string; trailing?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="grid h-[50px] items-center font-semibold" style={{ gridTemplateColumns: trailing ? `${cols} ${DELETE_COLUMN}px` : cols }}>
      <span className="pl-[5px]">{t("Итого")}</span>
      <span /><span />
      <span data-no-translate className="pl-[5px]">{formatNumber(value)}</span>
      {trailing && <span />}
    </div>
  )
}

/** Stored data rendered by a shared picker or editor (stage, item and unit names): the page translator leaves it
 * alone. Every app text inside those components already goes through t(). `display: contents`, so the layout is
 * the component's own. */
function StoredData({ children }: { children: ReactNode }) {
  return (
    <div data-no-translate className="contents">
      {children}
    </div>
  )
}

/** Defect rows: name | amount | photo | comment (see DefectTable). */
const DEFECT_COLUMNS: Columns = { template: "minmax(150px,454px) minmax(100px,182px) 72px minmax(160px,1fr)", min: 150 + 100 + 72 + 160 }

function DefectTable({ title, rows, onDelete, onPhoto }: { title: string; rows: Movement[]; onDelete?: (id: number) => void; onPhoto: (row: Movement) => void }) {
  const { t } = useLanguage()
  // Name | amount | photo (drawn on every row, as in the reference: the picture, which a click enlarges, or a neutral
  // placeholder) | the defect line's comment (kept from Mezon: it is the only place the comment shows). Name and
  // amount line up with the "Произведенные продукты" tab (454 / 182 px); on a narrower card they give way first (down
  // to their floors), so the comment keeps at least 160 px.
  const grid = onDelete ? `${DEFECT_COLUMNS.template} ${DELETE_COLUMN}px` : DEFECT_COLUMNS.template
  return (
    <div>
      <div className={`relative grid h-[56px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
        <div className="pl-2">{t(title)}</div>
        <div className="pl-2">{t("Кол-во")}</div>
        <div />
        <div className="pl-2">{t("Комментарий")}</div>
        {onDelete && <div />}
      </div>
      {rows.map((row) => (
        <div key={row.id} className={`${ROW} min-h-[60px]`} style={{ gridTemplateColumns: grid }}>
          <span data-no-translate className="break-words pl-[13px]">{row.name}</span>
          <span data-no-translate className="pl-[13px]">{formatAmount(row.amount, row.unit)}</span>
          <span className="py-[5px]">
            {row.image ? (
              <button type="button" onClick={() => onPhoto(row)} aria-label={t("Фото")} className="block h-[50px] w-[50px] overflow-hidden rounded">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={row.image} alt={row.name} data-no-translate className="h-full w-full object-cover" />
              </button>
            ) : (
              <span title={t("Нет фото")} className="flex h-[50px] w-[50px] items-center justify-center rounded bg-[#f5f6f8]">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#c4c4c4]" role="img" aria-label={t("Нет фото")}><path d={PHOTO_ICON} /></svg>
              </span>
            )}
          </span>
          <span data-no-translate className="whitespace-pre-wrap break-words py-2 pl-2">{row.comment || "-"}</span>
          {onDelete && <DeleteButton onClick={() => onDelete(row.id)} />}
        </div>
      ))}
    </div>
  )
}

/** A defect's photo at full size over the page, as the reference's slideshow shows it; Escape, the backdrop or ✕ closes it. */
function PhotoViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={t("Фото")} onClick={onClose} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-6">
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center text-white">
        <X className="h-7 w-7" strokeWidth={1.6} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} data-no-translate onClick={(event) => event.stopPropagation()} className="max-h-[85vh] max-w-[90vw] bg-white object-contain shadow-2xl" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

type DialogProps = { party: PartyDetail; onClose: () => void; onSaved: (detail: PartyDetail) => void }

/** A quantity as the reference shows it in a field: digit groups, up to 6 decimals ("1 000", "0,5"). */
const quantityFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 })

type ComponentLine = { key: string; name: string; unit: string; amount: number }

/** The raw materials a norm consumes for `quantity` of its product — the server's own calculation
 * (lib/production-batches-repo.ts autoFinishComponents): each raw line × quantity ÷ the norm's quantity, the same item
 * once. The norm's ready lines (what it puts out, by-products included) are neither consumed nor produced. */
function normComponents(recipe: Recipe, quantity: number): ComponentLine[] {
  const lines = new Map<string, ComponentLine>()
  for (const component of recipe.components) {
    if (component.role !== "raw") continue
    const line = lines.get(component.key) ?? { key: component.key, name: component.name, unit: component.unit, amount: 0 }
    line.amount += (component.amount * quantity) / (recipe.amount > 0 ? recipe.amount : 1)
    lines.set(component.key, line)
  }
  return [...lines.values()].map((line) => ({ ...line, amount: Math.round(line.amount * 1e6) / 1e6 }))
}

/** «Автодобавление», as in the reference: choosing a product fills Кол-во with its norm's quantity and lists the raw
 * materials it consumes at once (worked out again 500 ms after Кол-во changes; read only: Наименование | Норма |
 * Доступно, red above the stock). Подтвердить sends the product and the amount; the server books the norm's
 * consumption and finishes the batch. */
function AutoAddDialog({ party, recipes, stock, loading, onClose, onSaved }: DialogProps & { recipes: Recipe[]; stock: StockItem[]; loading: boolean }) {
  const { t } = useLanguage()
  const [recipeKey, setRecipeKey] = useState("")
  const [amount, setAmount] = useState("")
  // The quantity the components are worked out for: at once when a product is chosen, 500 ms after typing.
  const [quantity, setQuantity] = useState<number | null>(null)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const recipe = recipes.find((entry) => entry.key === recipeKey)
  const typed = readQuantity(amount)
  const valid = validQuantity(typed)
  const stockByKey = useMemo(() => new Map(stock.map((item) => [item.key, item])), [stock])
  const components = useMemo(() => (recipe && quantity !== null ? normComponents(recipe, quantity) : null), [recipe, quantity])
  // Same rule as the server (autoFinishParty → 409): good output needs at least one good raw line — one of the
  // norm's, or one the batch already has (spoiled raw is no part of the output).
  const hasRaw = party.raw.length > 0
  const noRaw = components !== null && components.length === 0 && !hasRaw
  const amountError = recipe && !valid && (touched || amount.trim() !== "") ? QUANTITY_ERROR : undefined

  useEffect(() => {
    const timer = window.setTimeout(() => setQuantity(valid ? typed : null), 500)
    return () => window.clearTimeout(timer)
  }, [typed, valid])

  function choose(key: string) {
    setRecipeKey(key)
    setTouched(false)
    const next = recipes.find((entry) => entry.key === key)
    if (!next) return
    setAmount(quantityFormat.format(next.amount))
    setQuantity(next.amount)
  }

  async function confirm() {
    setTouched(true)
    if (!recipe || !valid || noRaw) return
    setSaving(true)
    try {
      onSaved(await api<PartyDetail>(`/api/production/parties/${party.id}/auto-finish`, { method: "POST", body: { recipeId: recipe.id, amount: typed } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t("Автодобавление")}
      tall
      closeOnEscape
      onClose={onClose}
      width="max-w-[1000px]"
      footer={<SaveButton type="button" label="Подтвердить" saving={saving} disabled={!recipe || noRaw} onClick={confirm} />}
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-start">
        <Field label="Продукт">
          <StoredData>
            <ItemPicker items={recipes} value={recipeKey} onChange={choose} placeholder="Продукт" emptyText={loading ? "Загрузка..." : "Не найдено"} />
          </StoredData>
        </Field>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Кол-во")}</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => valid && setAmount(quantityFormat.format(typed))}
            inputMode="decimal"
            aria-label={t("Кол-во")}
            className={inputClass}
          />
          <FieldError message={amountError} />
        </div>
      </div>
      {!loading && !recipes.length && <p className="mt-3 text-sm text-amber-600">{t("У этапа нет продуктов. Добавьте их в разделе «Этапы производства».")}</p>}

      <h4 className="mt-6 font-semibold">{t("Компоненты")}</h4>
      {components?.length ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-dashed border-slate-300 text-left">
              <th className="py-2 font-semibold">{t("Наименование")}</th>
              <th className="py-2 font-semibold">{t("Норма")}</th>
              <th className="py-2 font-semibold">{t("Доступно")}</th>
            </tr>
          </thead>
          <tbody>
            {components.map((line, index) => {
              const item = stockByKey.get(line.key)
              const unit = item?.unit ?? line.unit
              const available = item?.available ?? 0
              return (
                <tr key={line.key} data-no-translate className="border-b border-dashed border-slate-200">
                  <td className="py-2.5">
                    {index + 1}. {item?.name ?? line.name}
                  </td>
                  <td className={`py-2.5 ${line.amount > available ? "text-red-500" : ""}`}>{formatAmount(line.amount, unit)}</td>
                  <td className="py-2.5">{formatAmount(available, unit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className={`py-12 text-center text-sm ${noRaw ? "text-amber-600" : "text-slate-400"}`}>
          {!recipe
            ? t("Пожалуйста, выберите продукт")
            : components === null
              ? ""
              : t(hasRaw ? "У продукта нет сырья — будет добавлен только готовый продукт" : "В партии нет сырья — добавьте сырье, чтобы завершить ее")}
        </p>
      )}
    </Modal>
  )
}

/** Validation texts of the defect dialog (the server's own wording, lib/production-api.ts). */
const REQUIRED_ERROR = "Это поле обязательно к заполнению"
const AMOUNT_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
const MAX_AMOUNT = 1e9

type DefectErrors = { type?: string; key?: string; amount?: string }

function FieldError({ message }: { message?: string }) {
  const { t } = useLanguage()
  return message ? <span className="mt-1 block text-[12px] text-[#f44336]">{t(message)}</span> : null
}

/** Spoiled raw is one of the batch's own raw materials, as the reference lists it (detail.rawProducts): each raw line's
 * item once, without stock figures. */
function batchRawItems(party: PartyDetail): CatalogItem[] {
  const items = new Map<string, CatalogItem>()
  for (const row of party.raw) {
    if (items.has(row.key)) continue
    const [kind, id] = row.key.split(":")
    items.set(row.key, { key: row.key, kind: kind === "raw_material" ? "raw_material" : "product", id: Number(id) || 0, name: row.name, unit: row.unit, type: "" })
  }
  return [...items.values()]
}

function DefectDialog({ party, products, loading, onClose, onSaved }: DialogProps & { products: CatalogItem[]; loading: boolean }) {
  const { t } = useLanguage()
  const [type, setType] = useState<"" | "made" | "raw">("")
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [image, setImage] = useState("")
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<DefectErrors>({})
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Like the reference: «Сырье» lists the batch's own raw lines, «Продукт» every product (the stage's own first).
  const rawItems = useMemo(() => batchRawItems(party), [party])
  const items: CatalogItem[] = type === "raw" ? rawItems : products
  const unit = items.find((item) => item.key === key)?.unit ?? ""
  // A message goes as soon as its field is filled in.
  const clear = (field: keyof DefectErrors) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  async function pickImage(file: File | undefined) {
    if (!file) return
    try {
      setImage(await readPhotoFile(file))
    } catch (error) {
      notify((error as Error).message)
    }
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    void pickImage(event.dataTransfer.files?.[0])
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount)
    // Every missing or wrong field says so (the reference answers each with a message), instead of a silent button.
    const found: DefectErrors = {
      ...(type ? {} : { type: REQUIRED_ERROR }),
      ...(type && !key ? { key: REQUIRED_ERROR } : {}),
      ...(amount.trim() !== "" && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT ? {} : { amount: AMOUNT_ERROR }),
    }
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      onSaved(await api<PartyDetail>(`/api/production/parties/${party.id}/defects`, { method: "POST", body: { type, key, amount: value, comment, image } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Добавление брака")} tall closeOnEscape width="max-w-[700px]" onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          void pickImage(event.target.files?.[0])
          // The same file can be chosen again after a refusal.
          event.target.value = ""
        }}
      />
      {/* A click picks a photo; a photo can also be dropped here, as in the reference. */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`mx-auto mb-6 flex h-[200px] w-[200px] flex-col items-center justify-center gap-2 overflow-hidden border border-dashed text-[13px] text-[#333] ${dragging ? "border-[#1E4A9A] bg-[#eef2f8]" : "border-[#dcdcdc]"}`}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-[#c4c4c4]" aria-hidden><path d={PHOTO_ICON} /></svg>
            {t("Добавьте фото")}
          </>
        )}
      </button>
      <div className="space-y-5">
        <Field label="Тип брака">
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as typeof type)
              setKey("")
              clear("type")
              clear("key")
            }}
            className={inputClass}
          >
            {/* Nothing is chosen until the user picks a type; the list itself offers only the two types. */}
            <option value="" disabled hidden />
            <option value="raw">{t("Сырье")}</option>
            <option value="made">{t("Продукт")}</option>
          </select>
          <FieldError message={errors.type} />
        </Field>
        {type && (
          <Field label={type === "raw" ? "Сырье" : "Продукт"}>
            <StoredData>
              <ItemPicker
                items={items}
                value={key}
                onChange={(next) => {
                  setKey(next)
                  clear("key")
                }}
                emptyText={type === "made" && loading ? "Загрузка..." : "Не найдено"}
              />
            </StoredData>
            <FieldError message={errors.key} />
          </Field>
        )}
        <Field label="Количество">
          <span className="flex items-end gap-3">
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                clear("amount")
              }}
              inputMode="decimal"
              className={inputClass}
            />
            {unit && <span data-no-translate className="shrink-0 pb-[6px] text-[13px] text-[#333]">{unit}</span>}
          </span>
          <FieldError message={errors.amount} />
        </Field>
        <Field label="Комментарий">
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className={inputClass} />
        </Field>
      </div>
    </Modal>
  )
}

/** «Добавить сырье» / «Добавить продукты», as in the reference: a full-screen dialog whose picker lists the raw
 * materials of the stage's norms (raw) or the stage's products (made), each with «Доступно / Браковано» in the stage
 * warehouse; the list has the columns «Наименование | Кол-во», an item already in it is not added twice, a wrong
 * quantity says so, and saving an empty list just closes the dialog. Дата starts empty: the lines are booked on the
 * batch's date unless another day is chosen. */
function ItemsDialog({
  party,
  direction,
  items,
  loading,
  stageHasProducts,
  onClose,
  onSaved,
}: DialogProps & { direction: "raw" | "made"; items: StockItem[]; loading: boolean; stageHasProducts: boolean }) {
  const { t } = useLanguage()
  const [date, setDate] = useState("")
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!lines.length) {
      onClose()
      return
    }
    setSaving(true)
    try {
      onSaved(await api<PartyDetail>(`/api/production/parties/${party.id}/items`, { method: "POST", body: { direction, items: lines, ...(date ? { date } : {}) } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(direction === "raw" ? "Добавить сырье" : "Добавить продукты")} fullScreen closeOnEscape onClose={onClose} footer={<SaveButton type="button" saving={saving} onClick={save} />}>
      <div className="mb-4 flex items-end gap-6">
        <span className="pb-2 font-semibold">{t("Список товаров")}</span>
        <Field label="Дата" className="w-52">
          <input type="date" value={date} min="2000-01-01" max={todayIso()} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
      </div>
      {!loading && !stageHasProducts && <p className="mb-3 text-sm text-amber-600">{t("У этапа нет продуктов. Добавьте их в разделе «Этапы производства».")}</p>}
      <StoredData>
        <ItemLinesEditor
          items={items}
          lines={lines}
          onChange={setLines}
          showStock
          checkAvailable={direction === "raw"}
          duplicates="drop"
          validate
          headers={["Наименование", "Кол-во"]}
          editHint
          emptyText=""
          pickerEmptyText={loading ? "Загрузка..." : "Не найдено"}
        />
      </StoredData>
    </Modal>
  )
}

/** «Изменение партии», as in the reference: Этап производства (searchable) → Дата партии → Статус → Комментарий...
 * (1–3 lines), no required marks. Every status is offered (a finished batch can be reopened, a cancelled one taken
 * back); the stage and the date can change on a batch with lines too (the server keeps its stock where it is). */
function EditDialog({ party, stages, onClose, onSaved }: { party: PartyDetail; stages: Stage[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLanguage()
  const [stageId, setStageId] = useState(party.stageId ? String(party.stageId) : "")
  const [status, setStatus] = useState<PartyStatus>(party.status)
  const [date, setDate] = useState(party.date)
  const [comment, setComment] = useState(party.comment)
  const [stageError, setStageError] = useState("")
  // The server's refusal of the comment (more than 500 characters, as the reference refuses), under the field.
  const [commentError, setCommentError] = useState("")
  const [saving, setSaving] = useState(false)
  const stageOptions = useMemo(() => stages.map((stage) => ({ value: String(stage.id), label: stage.name })), [stages])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!stageId) {
      setStageError(FIELD_REQUIRED)
      return
    }
    setSaving(true)
    try {
      await api(`/api/production/parties/${party.id}`, { method: "PUT", body: { stageId: Number(stageId), status, date, comment } })
      await onSaved()
    } catch (error) {
      if (error instanceof ApiError && error.field === "comment") setCommentError(error.message)
      else notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Изменение партии")} width="max-w-[700px]" closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} label="Изменить" />}>
      <div className="space-y-5">
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Этап производства")}</span>
          {/* Stored stage names: rawLabels keeps them from the page translator. */}
          <SearchSelect
            variant="underline"
            allowClear={false}
            rawLabels
            value={stageId}
            onChange={(value) => {
              setStageId(value)
              setStageError("")
            }}
            options={stageOptions}
            selectedLabel={party.stageName}
            invalid={Boolean(stageError)}
          />
          <FieldError message={stageError} />
        </div>
        <Field label="Дата партии">
          <input required type="date" value={date} min="2000-01-01" max={todayIso()} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Статус">
          <select value={status} onChange={(event) => setStatus(event.target.value as PartyStatus)} className={inputClass}>
            {STATUS_TRANSITIONS[party.status].map((value) => (
              <option key={value} value={value}>
                {t(STATUS_LABELS[value])}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Комментарий...">
          <textarea
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
              setCommentError("")
            }}
            rows={Math.min(3, Math.max(1, comment.split("\n").length))}
            className={`${inputClass} resize-none ${commentError ? "!border-[#f44336]" : ""}`}
          />
          <FieldError message={commentError} />
        </Field>
      </div>
    </Modal>
  )
}
