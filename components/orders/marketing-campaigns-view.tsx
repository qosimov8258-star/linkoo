"use client";

import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit";
import { useEffect, useMemo, useState } from "react";
import { useRefRecords } from "@/lib/use-ref-records";
import { EMPTY_PROMO_FILTERS, PromoFilterDrawer, type PromoFilters } from "./promo-filter-drawer";
import { csvText } from "@/lib/csv";
import { parseAnyDay } from "@/lib/finance/dates";
import { formatDateText } from "@/lib/i18n/format-date";
import { useLanguage } from "@/lib/i18n/language-context";
import { PromoForm, emptyPromoForm } from "./promo-form";

type Promo = {
  id: number;
  name: string;
  start: string;
  end: string;
  type: string;
  active: boolean;
};


type Tab = "Активные" | "Не активные" | "Все";

/** Day "YYYY-MM-DD" of a stored promotion date: new ones are ISO days, older records a Russian label ("25 апр. 2026"). */
const promoDay = (text: string) => parseAnyDay(text) ?? "";

export function MarketingCampaignsView() {
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<Tab>("Все");
  const { rows: promos, create } = useRefRecords<Promo>("promo");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<PromoFilters>(EMPTY_PROMO_FILTERS);
  const [applied, setApplied] = useState<PromoFilters>(EMPTY_PROMO_FILTERS);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyPromoForm);
  const [currencies, setCurrencies] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/currencies").then((r) => (r.ok ? r.json() : [])).then((rows: { name?: string }[]) => setCurrencies(Array.isArray(rows) ? rows.map((row) => row.name ?? "").filter(Boolean) : [])).catch(() => {});
  }, []);

  const rows = useMemo(() => promos.filter((promo) => {
    const suitableTab = tab === "Все" || (tab === "Активные" ? promo.active : !promo.active);
    const suitableSearch = promo.name.toLowerCase().includes(search.toLowerCase()) || promo.type.toLowerCase().includes(search.toLowerCase());
    const types = applied.select.type ?? [];
    const suitableType = types.length === 0 || types.includes(t(promo.type));
    const suitableStart = !applied.start || (promoDay(promo.start) !== "" && promoDay(promo.start) >= applied.start);
    const suitableEnd = !applied.end || (promoDay(promo.end) !== "" && promoDay(promo.end) <= applied.end);
    return suitableTab && suitableSearch && suitableType && suitableStart && suitableEnd;
  }), [applied, promos, search, tab, t]);

  const downloadCsv = () => {
    const csv = csvText([[t("№ акции"), t("Наименование"), t("Дата начала"), t("Дата завершения"), t("Тип акции")], ...rows.map((row) => [row.id, row.name, formatDateText(row.start, language), formatDateText(row.end, language), t(row.type)])]);
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "marketing-campaigns.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const addPromo = async () => {
    const name = form.name.trim();
    if (!name || !form.start || !form.end) return;
    await create({
      name,
      start: form.start,
      end: form.end,
      type: form.config.type,
      active: form.active,
      config: form.config,
    } as Omit<Promo, "id">);
    setAddOpen(false);
    setForm(emptyPromoForm());
  };

  const paging = usePaging(rows.length);
  const pageRows = rows.slice(paging.start, paging.end);

  return (
    <RefPage>
      <RefHeader title={t("Маркетинговые акции")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setAddOpen(true)} />
      </RefHeader>

      <RefCard>
        <RefTabs labels={["Активные", "Не активные", "Все"]} value={tab} onChange={(value) => { setTab(value as Tab); paging.setPage(1); }} />
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <PromoFilterDrawer
              filters={filters}
              onChange={setFilters}
              onApply={() => { setApplied(filters); paging.setPage(1); setFilterOpen(false); }}
              onClose={() => setFilterOpen(false)}
            />
          }
          query={search}
          onQuery={(value) => { setSearch(value); paging.setPage(1); }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={rows.length ? paging.start + 1 : 0}
          to={paging.end}
          total={rows.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={<><RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" /><RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadCsv} /></>}
        />
        <RefTable
          cols="minmax(0,1fr) minmax(0,5fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr)"
          heads={[t("№ акции"), t("Наименование"), t("Дата начала"), t("Дата завершения"), t("Тип акции")]}
          rows={pageRows}
          rowKey={(promo) => promo.id}
          empty={<div className="flex flex-col items-center"><img src="/robot-empty.png" alt="" className="w-[120px]" /><span className="-mt-[22px]">{t("По вашему запросу ничего не найдено")}</span></div>}
          render={(promo) => [promo.id, promo.name, formatDateText(promo.start, language), formatDateText(promo.end, language), t(promo.type)]}
        />
      </RefCard>

      {addOpen && <PromoForm value={form} onChange={setForm} onSave={() => void addPromo()} onClose={() => setAddOpen(false)} currencies={currencies} />}
    </RefPage>
  );
}
