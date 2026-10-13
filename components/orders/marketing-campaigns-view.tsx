"use client";

import { X } from "lucide-react";
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit";
import { FormEvent, useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";

type Promo = {
  id: number;
  name: string;
  start: string;
  end: string;
  type: string;
  active: boolean;
};

const initialPromos: Promo[] = [];

type Tab = "Активные" | "Не активные" | "Все";

const toDisplayDate = (value: string) => {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

export function MarketingCampaignsView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("Активные");
  const [promos, setPromos] = useState(initialPromos);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterType, setFilterType] = useState("Все типы");
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => promos.filter((promo) => {
    const suitableTab = tab === "Все" || (tab === "Активные" ? promo.active : !promo.active);
    const suitableSearch = promo.name.toLowerCase().includes(search.toLowerCase()) || promo.type.toLowerCase().includes(search.toLowerCase());
    const suitableType = filterType === "Все типы" || promo.type === filterType;
    return suitableTab && suitableSearch && suitableType;
  }), [filterType, promos, search, tab]);

  const downloadCsv = () => {
    const csv = [[t("№ акции"), t("Наименование"), t("Дата начала"), t("Дата завершения"), t("Тип акции")].join(";"), ...rows.map((row) => `${row.id};${row.name};${row.start};${row.end};${row.type}`)].join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "marketing-campaigns.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const addPromo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    setPromos((current) => [{
      id: Math.max(0, ...current.map((promo) => promo.id)) + 1,
      name,
      start: toDisplayDate(String(form.get("start") || "")),
      end: toDisplayDate(String(form.get("end") || "")),
      type: String(form.get("type") || "Бонус"),
      active: form.get("active") === "on",
    }, ...current]);
    setAddOpen(false);
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
            <div className="flex w-[420px] items-end gap-4 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="flex-1 text-[10px] font-bold">{t("Тип акции")}
                <select value={filterType} onChange={(event) => setFilterType(event.target.value)} className="mt-1 block w-full border-b border-[#e0e0e0] bg-white py-2 text-[13px] font-normal outline-none">
                  {["Все типы", "Бонус", "Скидка", "Балл", "Надбавка"].map((item) => <option key={item} value={item}>{t(item)}</option>)}
                </select>
              </label>
              <RefButton green label={t("Применить")} onClick={() => setFilterOpen(false)} />
            </div>
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
          icons={<><RefIconButton path={RI.checklist} label={t("Выбрать")} color="#5d6474" /><RefIconButton path={RI.download} label={t("Скачать CSV")} onClick={downloadCsv} /></>}
        />
        <RefTable
          cols="minmax(0,110fr) minmax(0,330fr) minmax(0,200fr) minmax(0,200fr) minmax(0,200fr)"
          heads={[t("№ акции"), t("Наименование"), t("Дата начала"), t("Дата завершения"), t("Тип акции")]}
          rows={pageRows}
          rowKey={(promo) => promo.id}
          empty={<div className="flex flex-col items-center"><img src="/robot-empty.png" alt="" className="w-[120px]" /><span className="-mt-[22px]">{t("По вашему запросу ничего не найдено")}</span></div>}
          render={(promo) => [promo.id, promo.name, promo.start, promo.end, t(promo.type)]}
        />
      </RefCard>

      {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <form onSubmit={addPromo} className="w-full max-w-[520px] rounded-lg bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-xl font-semibold">{t("Добавить акцию")}</h2><button type="button" onClick={() => setAddOpen(false)}><X /></button></div>
          <div className="grid gap-4 p-6">
            <label className="font-medium">{t("Наименование")}<input required name="name" className="mt-1 w-full rounded border border-slate-300 px-3 py-2 outline-[#4f71dc]" /></label>
            <div className="grid grid-cols-2 gap-4"><label className="font-medium">{t("Дата начала")}<input name="start" type="date" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label><label className="font-medium">{t("Дата завершения")}<input name="end" type="date" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label></div>
            <label className="font-medium">{t("Тип акции")}<select name="type" className="mt-1 w-full rounded border border-slate-300 px-3 py-2"><option value="Бонус">{t("Бонус")}</option><option value="Скидка">{t("Скидка")}</option><option value="Балл">{t("Балл")}</option><option value="Надбавка">{t("Надбавка")}</option></select></label>
            <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked />{t("Активная акция")}</label>
          </div>
          <div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setAddOpen(false)} className="rounded px-4 py-2">{t("Отмена")}</button><button className="rounded bg-[#71ce87] px-5 py-2 font-semibold text-white">{t("Сохранить")}</button></div>
        </form>
      </div>}
    </RefPage>
  );
}
