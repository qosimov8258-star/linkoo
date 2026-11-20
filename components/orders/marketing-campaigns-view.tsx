"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { SortHead, sortByOrdering, toggleOrdering } from "@/components/analytics/list-url-state";
import { RI, RefAppliedFilter, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit";
import { downloadExcelTable } from "@/lib/excel-export";
import { parseAnyDay, todayIso } from "@/lib/finance/dates";
import { formatDateText } from "@/lib/i18n/format-date";
import { useLanguage } from "@/lib/i18n/language-context";
import { useRefRecords } from "@/lib/use-ref-records";

import { queryInt, useLinkoUrlState } from "./linko-url-state";
import { PromoDetail, type PromoRef } from "./promo-detail";
import { PROMO_FILTER_PARAMS, PromoFilterDrawer, countPromoFilters, promoFilterQuery, readPromoFilters, type PromoFilters } from "./promo-filter-drawer";
import { PromoForm, emptyPromoForm } from "./promo-form";

// Продажи → «Маркетинговые акции» (Linko #/prices, API market/promotion/): the promotions newest first, tabs Активные /
// Не активные / Все (status=active / inactive, «Все» by default), search by name, Linko's filter, sorting by № / dates
// and the promotion's card under its row (/analytics/marketing-campaigns/<id> = #/prices/<id>). The URL keeps the list
// state with Linko's names. Rows: ref_records kind promo (Linko's documents copied by scripts/linko-sync, `ref`).

type Promo = {
  id: number;
  name: string;
  start: string;
  end: string;
  type: string;
  active: boolean;
  /** The day the promotion was created here (promotions copied from Linko carry ref.created_date). */
  createdAt?: string;
  config?: { audience?: string };
  /** The reference's promotion document (imported from Linko): shown in the detail card. */
  ref?: PromoRef;
};

const BASE = "/analytics/marketing-campaigns";
const ORDERINGS = ["id", "begin_date", "till_date"] as const;

/** Linko's marketingType: the list's «Тип акции» of a promotion type. */
const MARKETING_TYPE: Record<string, string> = { discount: "Скидка", bonus: "Бонус", addup: "Надбавка", ball: "Балл", cash_back: "Кэшбек" };
/** A promotion created here stores the form's Russian type; Linko's key of it. */
const TYPE_KEY: Record<string, string> = { Бонус: "bonus", Скидка: "discount", Надбавка: "addup", Балл: "ball", Кэшбэк: "cash_back" };
/** The form's «Действует для клиентов» choice → Linko's promotion_type. */
const AUDIENCE_KEY: Record<string, string> = {
  "Для всех": "promotion_all",
  "Выбранным агентам": "promotion_agents",
  "Выбранным филиалам": "promotion_branches",
  "Выбранным типам клиентов": "promotion_market_types",
  "Выбранным клиентам": "promotion_one",
};

/** Day "YYYY-MM-DD" of a stored promotion date: new ones are ISO days, older records a Russian label ("25 апр. 2026"). */
const promoDay = (text: string | undefined) => parseAnyDay(text ?? "") ?? "";
const typeKeyOf = (promo: Promo) => promo.ref?.type ?? TYPE_KEY[promo.type] ?? promo.type;

/** Running today: Linko's «Активные» are the promotions whose period holds today (Asia/Tashkent). */
function isActive(promo: Promo, day: string): boolean {
  const start = promoDay(promo.start);
  const end = promoDay(promo.end);
  if (start && end) return start <= day && day <= end;
  return promo.active;
}

/** A promotion created here (no reference document): its card shows what the list knows. */
function fallbackRef(promo: Promo): PromoRef {
  return { id: promo.id, name: promo.name, type: typeKeyOf(promo), begin_date: promoDay(promo.start), till_date: promoDay(promo.end), bonus_type: "auto", discount_type: "percent", promotion_type: AUDIENCE_KEY[promo.config?.audience ?? ""] ?? "promotion_all", products: [] };
}

/** The card's document: Linko's copy with the list's dates (changed here by «Изменение»), else what the list knows. */
function cardRef(promo: Promo): PromoRef {
  if (!promo.ref) return fallbackRef(promo);
  return { ...promo.ref, begin_date: promoDay(promo.start) || promo.ref.begin_date, till_date: promoDay(promo.end) || promo.ref.till_date };
}

const ICON = {
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  boxEmpty: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  boxChecked: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  minusBox: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z",
};

const ids = (items: { id?: number }[] | undefined) => (items ?? []).map((item) => String(item.id ?? ""));
const productIds = (promo: Promo, type: "1" | "2") => (promo.ref?.products ?? []).filter((item) => String(item.type) === type).map((item) => String(item.product?.id ?? ""));
const within = (day: string, from: string, to: string) => (!from && !to) || (day !== "" && (!from || day >= from) && (!to || day <= to));

/**
 * Linko's filter on the copied documents. Тип акции, Действует для, Филиалы (a promotion without branches counts for
 * every branch, as Linko answers) and the three periods (inclusive days) work as in Linko. Linko's API ignores
 * Прайс-лист, Товары для закупа and Товары в подарок (every promotion comes back); here they keep the promotions that
 * apply to that price list (none chosen = all) or hold one of the products. Организация: a promotion with a product of
 * that organization (what Linko returns).
 */
function matchesFilters(promo: Promo, filters: PromoFilters, productOrg: Map<string, string>, divisionNames: Map<string, string>): boolean {
  const ref = promo.ref;
  if (filters.type.length && !filters.type.includes(typeKeyOf(promo))) return false;
  const audience = ref?.promotion_type ?? AUDIENCE_KEY[promo.config?.audience ?? ""] ?? "promotion_all";
  if (filters.promotionType.length && !filters.promotionType.includes(audience)) return false;
  const branches = ids(ref?.branches);
  if (filters.branch.length && branches.length && !branches.some((id) => filters.branch.includes(id))) return false;
  const priceLists = ids(ref?.price_lists);
  if (filters.priceList && priceLists.length && !priceLists.includes(filters.priceList)) return false;
  if (filters.conditionProducts.length && !productIds(promo, "1").some((id) => filters.conditionProducts.includes(id))) return false;
  if (filters.bonusProducts.length && !productIds(promo, "2").some((id) => filters.bonusProducts.includes(id))) return false;
  if (filters.division.length) {
    const wanted = new Set(filters.division.map((id) => divisionNames.get(id)).filter(Boolean));
    const products = [...productIds(promo, "1"), ...productIds(promo, "2")];
    if (!products.some((id) => wanted.has(productOrg.get(id)))) return false;
  }
  const created = (ref?.created_date ?? promo.createdAt ?? "").slice(0, 10);
  if (!within(created, filters.fromDate, filters.toDate)) return false;
  if (!within(promoDay(promo.start), filters.fromDate1, filters.toDate1)) return false;
  if (!within(promoDay(promo.end), filters.fromDate2, filters.toDate2)) return false;
  return true;
}

export function MarketingCampaignsView() {
  const { t, language } = useLanguage();
  const { rows: promos, create, reload } = useRefRecords<Promo>("promo");
  const { state, update } = useLinkoUrlState(BASE);
  const query = state.query;
  const status = query.status === "active" || query.status === "inactive" ? query.status : "";
  const search = query.search ?? "";
  const pageSize = queryInt(query.pageSize, 25);
  const ordering = useMemo(() => (query.ordering ?? "").split(",").filter((item) => (ORDERINGS as readonly string[]).includes(item.replace(/^-/, ""))), [query.ordering]);
  const filters = useMemo(() => readPromoFilters(query), [query]);
  const filterCount = countPromoFilters(filters);
  const filterOpen = query.openFilterDialog === "true";
  const addOpen = query.openCreateDialog === "true";
  const openId = state.id && /^\d+$/.test(state.id) ? Number(state.id) : null;
  // Linko's select mode: ?showCheckboxes=true&select=111-110.
  const selectMode = query.showCheckboxes === "true";
  const selected = useMemo(() => (selectMode ? (query.select ?? "").split("-").filter((id) => /^\d+$/.test(id)).map(Number) : []), [query.select, selectMode]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const [form, setForm] = useState(emptyPromoForm);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [lookups, setLookups] = useState<{ productOrg: Map<string, string>; divisionNames: Map<string, string> } | null>(null);
  const day = useMemo(() => todayIso(), []);

  useEffect(() => {
    fetch("/api/currencies").then((r) => (r.ok ? r.json() : [])).then((rows: { name?: string }[]) => setCurrencies(Array.isArray(rows) ? rows.map((row) => row.name ?? "").filter(Boolean) : [])).catch(() => {});
  }, []);

  // The «Организация» filter needs each product's organization; loaded only when that filter is used.
  useEffect(() => {
    if (!filters.division.length || lookups) return;
    const load = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    void Promise.all([load("/api/products"), load("/api/organizations")]).then(([products, organizations]) => {
      const productOrg = new Map<string, string>((Array.isArray(products) ? products : []).map((row: { id?: number; organization?: string }) => [String(row.id), String(row.organization ?? "")]));
      const divisionNames = new Map<string, string>((Array.isArray(organizations) ? organizations : []).map((row: { id?: number; name?: string }) => [String(row.id), String(row.name ?? "")]));
      setLookups({ productOrg, divisionNames });
    });
  }, [filters.division.length, lookups]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const found = promos.filter((promo) => {
      if (status && (status === "active") !== isActive(promo, day)) return false;
      // Linko searches the name only.
      if (needle && !promo.name.toLocaleLowerCase().includes(needle)) return false;
      return matchesFilters(promo, filters, lookups?.productOrg ?? new Map(), lookups?.divisionNames ?? new Map());
    });
    return sortByOrdering(found, ordering, {
      id: (a, b) => a.id - b.id,
      begin_date: (a, b) => promoDay(a.start).localeCompare(promoDay(b.start)),
      till_date: (a, b) => promoDay(a.end).localeCompare(promoDay(b.end)),
    });
  }, [day, filters, lookups, ordering, promos, search, status]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(queryInt(query.page, 1, 1e9), pageCount);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const typeLabel = (promo: Promo) => t(MARKETING_TYPE[typeKeyOf(promo)] ?? promo.type);
  const sort = (field: string) => update({ query: { ordering: toggleOrdering(ordering, field).join(","), page: null } });

  const downloadExcel = () => {
    // Linko's grid exports the rows of the page on screen.
    downloadExcelTable(t("Маркетинговые акции"), [
      [t("№ акции"), t("Наименование"), t("Дата начала"), t("Дата завершения"), t("Тип акции")],
      ...pageRows.map((row) => [row.id, row.name, formatDateText(promoDay(row.start), language) || null, formatDateText(promoDay(row.end), language) || null, typeLabel(row)]),
    ], { blankNulls: true });
  };

  const closeAdd = useCallback(() => update({ query: { openCreateDialog: "false" } }), [update]);

  const addPromo = async () => {
    const name = form.name.trim();
    if (!name || !form.start || !form.end) return;
    const created = await create({
      name,
      start: form.start,
      end: form.end,
      type: form.config.type,
      active: form.active,
      config: form.config,
    } as Omit<Promo, "id">);
    // Refused by the server (its reason is shown in the app alert): keep the form and what was typed.
    if (!created) return;
    closeAdd();
    setForm(emptyPromoForm());
  };

  const setSelected = (ids: number[]) => update({ query: { select: ids.length ? ids.join("-") : null } });
  const toggleRow = (id: number) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id));
  const selectIcon = selected.length ? (
    <RefIconButton path={ICON.minusBox} label={t("Снять выделение")} color="#5d6474" onClick={() => setSelected([])} />
  ) : selectMode ? (
    <RefIconButton path={RI.eyeOff} label={t("Спрятать флажки")} color="#5d6474" onClick={() => update({ query: { showCheckboxes: null, select: null } })} />
  ) : (
    <RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" onClick={() => update({ query: { showCheckboxes: "true" } })} />
  );

  const tabLabel = status === "active" ? "Активные" : status === "inactive" ? "Не активные" : "Все";
  const openPromo = openId === null ? null : promos.find((promo) => promo.id === openId) ?? null;

  return (
    <RefPage>
      <RefHeader title={t("Маркетинговые акции")}>
        <span title={t("Добавить акцию")}>
          <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => update({ query: { openCreateDialog: "true" } })} />
        </span>
      </RefHeader>

      <RefCard>
        <RefTabs
          labels={["Активные", "Не активные", "Все"]}
          value={tabLabel}
          onChange={(value) => update({ query: { status: value === "Активные" ? "active" : value === "Не активные" ? "inactive" : null, page: null } })}
        />
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => update({ query: { openFilterDialog: filterOpen ? "false" : "true" } })}
          hideSearch={selected.length > 0}
          leftSlot={
            selected.length > 0 ? (
              <span className="text-[13px] font-semibold text-[#333]">{t("Выбрано:")} {selected.length}</span>
            ) : !filterOpen && filterCount > 0 ? (
              <RefAppliedFilter
                count={filterCount}
                width={371.5}
                shift={5}
                onEdit={() => update({ query: { openFilterDialog: "true" } })}
                onClear={() => update({ query: { ...Object.fromEntries(PROMO_FILTER_PARAMS.map((key) => [key, null])), page: null } })}
              />
            ) : undefined
          }
          filterPanel={
            <PromoFilterDrawer
              initial={filters}
              onApply={(next) => update({ query: { ...promoFilterQuery(next), openFilterDialog: "false", page: null } })}
              onClose={() => update({ query: { openFilterDialog: "false" } })}
            />
          }
          query={search}
          onQuery={(value) => update({ query: { search: value, page: null } })}
          pageSize={pageSize}
          onPageSize={(size) => update({ query: { pageSize: size, page: null } })}
          from={rows.length ? start + 1 : 0}
          to={Math.min(start + pageSize, rows.length)}
          total={rows.length}
          page={page}
          pageCount={pageCount}
          onPage={(next) => update({ query: { page: next > 1 ? next : null } })}
          icons={
            <>
              {selected.length > 0 && (
                <span className="mr-[9px]" title={t("Изменить выбранные клиенты")}>
                  <RefButton icon={RI.edit} label={t("Изменить")} onClick={() => setBulkOpen(true)} />
                </span>
              )}
              {selectIcon}
              {!selected.length && <RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadExcel} />}
            </>
          }
        />
        <RefTable
          // The select mode adds Linko's 20px checkbox column in front.
          cols={`${selectMode ? "20px " : ""}minmax(0,1fr) minmax(0,5fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr)`}
          heads={[
            ...(selectMode
              ? [
                  <button key="all" type="button" aria-label={t("Выбрать все")} className="-ml-[16px] flex" onClick={() => setSelected(allOnPage ? selected.filter((id) => !pageRows.some((row) => row.id === id)) : [...new Set([...selected, ...pageRows.map((row) => row.id)])])}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
                      <path d={ICON.selectAll} />
                    </svg>
                  </button>,
                ]
              : []),
            <SortHead key="id" label={t("№ акции")} field="id" ordering={ordering} onSort={sort} className="-ml-2" />,
            <span key="name">{t("Наименование")}</span>,
            <SortHead key="begin" label={t("Дата начала")} field="begin_date" ordering={ordering} onSort={sort} />,
            <SortHead key="till" label={t("Дата завершения")} field="till_date" ordering={ordering} onSort={sort} />,
            <span key="type">{t("Тип акции")}</span>,
          ]}
          rows={pageRows}
          rowKey={(promo) => promo.id}
          onRowClick={(promo) => update({ id: openId === promo.id ? null : String(promo.id) })}
          rowClass={(promo) => (openId === promo.id ? "hidden" : selected.includes(promo.id) ? "!bg-[#f2f5f8]" : "")}
          expanded={(promo) =>
            openId === promo.id ? (
              <PromoDetail
                promo={cardRef(promo)}
                onClose={() => update({ id: null })}
                onDeleted={() => {
                  update({ id: null });
                  void reload();
                }}
              />
            ) : null
          }
          empty={t("По вашему запросу ничего не найдено")}
          render={(promo) => [
            ...(selectMode
              ? [
                  <button
                    key="check"
                    type="button"
                    aria-label={t("Выбрать")}
                    className="-ml-[16px] flex"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleRow(promo.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selected.includes(promo.id) ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                      <path d={selected.includes(promo.id) ? ICON.boxChecked : ICON.boxEmpty} />
                    </svg>
                  </button>,
                ]
              : []),
            <span key="id" className="-ml-2">{promo.id}</span>, promo.name, formatDateText(promoDay(promo.start), language), formatDateText(promoDay(promo.end), language), typeLabel(promo)]}
        />
        {/* A promotion opened by its address but outside the page on screen (Linko shows its card over the list). */}
        {openPromo && !pageRows.some((promo) => promo.id === openPromo.id) && (
          <PromoDetail
            promo={cardRef(openPromo)}
            onClose={() => update({ id: null })}
            onDeleted={() => {
              update({ id: null });
              void reload();
            }}
          />
        )}
      </RefCard>

      {bulkOpen && (
        <BulkDatesDialog
          ids={selected}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            setSelected([]);
            void reload();
          }}
        />
      )}

      {addOpen && <PromoForm value={form} onChange={setForm} onSave={() => void addPromo()} onClose={closeAdd} currencies={currencies} />}
    </RefPage>
  );
}

/** «Изменение» (Linko's bulk update of the ticked promotions): «Изменить дату начала акции» / «Изменить дату
 * завершение акции», each with its date, «Изменить». */
function BulkDatesDialog({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [changeBegin, setChangeBegin] = useState(false);
  const [changeTill, setChangeTill] = useState(false);
  const [begin, setBegin] = useState("");
  const [till, setTill] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function save() {
    if (saving) return;
    if ((!changeBegin && !changeTill) || (changeBegin && !begin) || (changeTill && !till)) {
      setError(t("Обязательное поле"));
      return;
    }
    const patch: Record<string, string> = {};
    if (changeBegin) patch.start = begin;
    if (changeTill) patch.end = till;
    setSaving(true);
    setError("");
    try {
      for (const id of ids) {
        const response = await fetch(`/api/ref-records/promo/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: unknown };
          setError(`№ ${id}: ${t(typeof body.error === "string" && body.error ? body.error : "Не удалось сохранить изменения на сервере")}`);
          return;
        }
      }
      onSaved();
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"));
    } finally {
      setSaving(false);
    }
  }

  const dateField = (label: string, value: string, onChange: (value: string) => void) => (
    <label className="relative mb-[6px] ml-[34px] block h-[45px] border-b border-[#e0e0e0]">
      <span className={`pointer-events-none absolute left-0 font-semibold text-black ${value ? "top-[3px] text-[10px] leading-[13px]" : "top-[19px] text-[13px] leading-[20px]"}`}>{t(label)}</span>
      {value && <span className="absolute bottom-[4px] left-0 text-[13px]">{value.split("-").reverse().join(".")}</span>}
      <input type="date" value={value} aria-label={t(label)} onChange={(event) => onChange(event.target.value)} onClick={(event) => event.currentTarget.showPicker?.()} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </label>
  );
  const check = (checked: boolean, onChange: (value: boolean) => void, label: string) => (
    <label className="flex h-[30px] cursor-pointer items-center gap-[10px] text-[13px] font-semibold text-[#333]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-[16px] w-[16px] accent-[#5d6474]" />
      {t(label)}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/[0.54] p-4" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[400px] max-w-full bg-white text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <b className="font-bold uppercase">{t("Изменение")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
              <path d={RI.close} />
            </svg>
          </button>
        </div>
        <div className="min-h-[243px] px-[30px] py-[25px]">
          {check(changeBegin, setChangeBegin, "Изменить дату начала акции")}
          {changeBegin && dateField("Дата начала акции", begin, setBegin)}
          {check(changeTill, setChangeTill, "Изменить дату завершение акции")}
          {changeTill && dateField("Дата завершения акции", till, setTill)}
          {error && <div className="mt-[10px] text-[12px] text-[#f44336]">{error}</div>}
        </div>
        <div className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button type="button" disabled={saving} onClick={() => void save()} className="h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50">
            {t("Изменить")}
          </button>
        </div>
      </div>
    </div>
  );
}
