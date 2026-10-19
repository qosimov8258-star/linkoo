"use client";

import { X } from "lucide-react";
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit";
import { FormEvent, useMemo, useState } from "react";
import { PROMO_SEED } from "./marketing-data";
import { useLanguage } from "@/lib/i18n/language-context";

type Promo = {
  id: number;
  name: string;
  start: string;
  end: string;
  type: string;
  active: boolean;
};

const initialPromos: Promo[] = PROMO_SEED;

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

      {addOpen && <div className="fixed inset-0 z-50 flex bg-white text-[13px]">
        <form onSubmit={addPromo} className="flex h-full w-full flex-col">
          <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]"><b className="uppercase">{t("Новая акция")}</b><button type="button" onClick={() => setAddOpen(false)} aria-label={t("Закрыть")}><X className="h-6 w-6" /></button></header>
          <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
            <aside className="space-y-[12px] overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[40px]">
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">{t("Название новой акции")} *<input required name="name" className="block h-[28px] w-full bg-transparent text-[13px] font-normal outline-none" /></label>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">{t("Дата начала акции")} *<input name="start" type="date" className="block h-[28px] w-full bg-transparent text-[13px] font-normal outline-none" /></label>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">{t("Дата завершения акции")} *<input name="end" type="date" className="block h-[28px] w-full bg-transparent text-[13px] font-normal outline-none" /></label>
              {[["type", ["Скидка", "Бонус", "Надбавка", "Балл", "Кэшбэк"], "Бонус"], ["add", ["Авто", "Ручной", "Авто от суммы заказа", "Авто от веса", "Авто от остатка"], "Авто"]].map(([name, items, def]) => (
                <div key={name as string} className="space-y-[10px] pt-[6px]">
                  {name === "add" && <p className="text-[10px] font-bold">{t("Добавление продуктов:")}</p>}
                  {(items as string[]).map((item) => <label key={item} className="flex cursor-pointer items-center gap-[8px] text-[10px] font-semibold"><input type="radio" name={name as string} value={item} defaultChecked={item === def} className="h-[16px] w-[16px]" />{t(item)}</label>)}
                </div>
              ))}
              <div className="space-y-[10px] pt-[6px]">
                <p className="text-[10px] font-bold">{t("Действует для клиентов:")}</p>
                {["Для всех", "Выбранным агентам", "Выбранным филиалам", "Выбранным типам клиентов", "Выбранным клиентам"].map((item, index) => <label key={item} className="flex cursor-pointer items-center gap-[8px] text-[10px] font-semibold"><input type="radio" name="audience" defaultChecked={index === 0} className="h-[16px] w-[16px]" />{t(item)}</label>)}
              </div>
              <label className="flex items-center gap-2 pt-[6px] text-[10px] font-semibold"><input name="active" type="checkbox" defaultChecked />{t("Активная акция")}</label>
            </aside>
            <main className="min-w-0 overflow-y-auto bg-[#f4f4f4] px-[14px] py-[12px]">
              <div className="grid grid-cols-2 gap-[14px]">
                <div className="bg-[#eceff3] p-[14px] text-[10px] font-semibold"><p className="mb-[10px] font-bold">{t("Условия закупа")}</p>{["В качестве бонуса давать только тот продукт, который купили.", "Считать в блоке", "При полном наборе выбранного списка (КОМБО, СЕТ)", "Указать кол-во для каждой позиции закупа"].map((item) => <label key={item} className="mb-[10px] flex items-center gap-[8px]"><input type="checkbox" />{t(item)}</label>)}</div>
                <div className="bg-[#eceff3] p-[14px] text-[10px] font-semibold"><p className="mb-[10px] font-bold">{t("Условия подарков")}</p><label className="flex items-center gap-[8px]"><input type="checkbox" />{t("Подарок один раз за заказ")}</label></div>
              </div>
              <div className="mt-[14px] grid grid-cols-2 gap-[14px]">
                {["Товары для закупа", "Товар в подарок"].map((title) => <div key={title} className="min-h-[200px] bg-white p-[14px] text-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12)]"><p className="mb-[10px] font-bold">{t(title)}</p><p className="mt-[60px] text-center text-slate-400">{t("Вы еще не выбрали ни одного товара")}</p></div>)}
              </div>
            </main>
          </div>
          <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] px-[14px]"><button className="text-[12px] font-bold uppercase text-[#0a9ddb]">{t("Применить акцию")}</button></footer>
        </form>
      </div>}
    </RefPage>
  );
}
