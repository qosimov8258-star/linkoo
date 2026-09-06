"use client";

import { Download, Filter, Pencil, Plus, Search, X } from "lucide-react";
import { FavoritesButton } from "@/components/dashboard/favorites-drawer";
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

  return (
    <main className="min-h-screen bg-[#f3f6fa] px-9 pb-12 pt-5 text-[#1f2d42]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[27px] font-semibold text-[#576276]"><FavoritesButton className="text-[#4d70df]" /><span className="mx-3 text-[#6d7380]">|</span>{t("Маркетинговые акции")}</h1>
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#70cf88] px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-[#5fbd77]"><Plus size={19} />{t("Добавить")}</button>
      </div>

      <section className="overflow-hidden rounded-md bg-white shadow-sm">
        <div className="grid grid-cols-3 border-b border-[#dfe3e9] text-center text-[17px]">
          {(["Активные", "Не активные", "Все"] as Tab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`border-b-4 px-4 py-3.5 transition ${tab === item ? "border-[#5670e6]" : "border-transparent hover:bg-slate-50"}`}>{t(item)}</button>
          ))}
        </div>

        <div className="flex min-h-[61px] items-center gap-4 px-6 py-2">
          {tab === "Все" ? (
            <button onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-md bg-[#516edf] px-4 py-2.5 font-semibold text-white"><Filter size={18} />{t("Показать фильтр")}</button>
          ) : (
            <div className="flex h-12 items-center text-[#6d7380]">
              <span className="pr-5">{t("Фильтр: 1 элемента")}</span>
              <button onClick={() => setFilterOpen((value) => !value)} className="border-x px-4 py-3 text-[#7c7f83] hover:bg-slate-50"><Pencil size={22} /></button>
              <button onClick={() => { setSearch(""); setFilterType("Все типы"); }} className="px-4 py-3 text-[#8a8d91] hover:bg-slate-50"><X size={22} /></button>
            </div>
          )}
          <label className="ml-3 flex w-[380px] items-center border-b border-[#d9dde3] py-2 text-[#8e98aa]">
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent outline-none placeholder:text-[#b7c0cc]" placeholder={t("Поиск")} />
            <Search size={27} className="text-[#b5bac2]" />
          </label>
          <div className="ml-auto flex items-center gap-5 text-[#667080]">
            <span>25⌄</span><span>{rows.length ? `1 - ${Math.min(25, rows.length)} ${t("из")} ${rows.length}` : `1 - 0 ${t("из")} 0`}</span><span className="text-2xl">◀</span><span className="text-2xl">▶</span>
            <button onClick={downloadCsv} title={t("Скачать CSV")} className="hover:text-[#4f6ce4]"><Download size={24} /></button>
          </div>
        </div>

        {filterOpen && <div className="flex items-end gap-5 border-t border-[#e3e7ed] bg-[#fafbfc] px-6 py-4">
          <label className="w-72 text-sm font-semibold">{t("Тип акции")}<select value={filterType} onChange={(event) => setFilterType(event.target.value)} className="mt-1 block w-full border-b border-[#cfd6df] bg-white px-2 py-2 text-base font-normal outline-none"><option value="Все типы">{t("Все типы")}</option><option value="Бонус">{t("Бонус")}</option><option value="Скидка">{t("Скидка")}</option><option value="Балл">{t("Балл")}</option><option value="Надбавка">{t("Надбавка")}</option></select></label>
          <button onClick={() => setFilterOpen(false)} className="rounded-md bg-[#70cf88] px-6 py-2.5 font-semibold text-white">{t("Применить")}</button>
        </div>}

        <div className="min-h-[407px]">
          <div className="grid grid-cols-[150px_1fr_295px_295px_300px] bg-[#626d81] px-9 py-5 font-semibold text-white">
            <span>{t("№ акции")}</span><span>{t("Наименование")}</span><span>{t("Дата начала")}</span><span>{t("Дата завершения")}</span><span>{t("Тип акции")}</span>
          </div>
          {rows.length ? rows.map((promo, index) => <div key={promo.id} className={`grid grid-cols-[150px_1fr_295px_295px_300px] border-b border-dashed border-[#d8e0e9] px-9 py-4 text-[17px] ${index % 7 === 0 ? "bg-[#f3f6f9]" : "bg-white"}`}>
            <span>{promo.id}</span><span>{promo.name}</span><span>{promo.start}</span><span>{promo.end}</span><span>{t(promo.type)}</span>
          </div>) : <div className="flex min-h-[340px] flex-col items-center justify-center gap-6 bg-white pb-4"><img src="/robot-mascot.png" alt={t("Нет данных")} className="h-36 w-auto object-contain" /><p className="text-[17px] text-[#697386]">{t("По вашему запросу ничего не найдено")}</p></div>}
        </div>
      </section>

      {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
        <form onSubmit={addPromo} className="w-full max-w-[520px] rounded-lg bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-xl font-semibold">{t("Добавить акцию")}</h2><button type="button" onClick={() => setAddOpen(false)}><X /></button></div>
          <div className="grid gap-4 p-6">
            <label className="font-medium">{t("Наименование")}<input required name="name" className="mt-1 w-full rounded border border-slate-300 px-3 py-2 outline-[#516edf]" /></label>
            <div className="grid grid-cols-2 gap-4"><label className="font-medium">{t("Дата начала")}<input name="start" type="date" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label><label className="font-medium">{t("Дата завершения")}<input name="end" type="date" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" /></label></div>
            <label className="font-medium">{t("Тип акции")}<select name="type" className="mt-1 w-full rounded border border-slate-300 px-3 py-2"><option value="Бонус">{t("Бонус")}</option><option value="Скидка">{t("Скидка")}</option><option value="Балл">{t("Балл")}</option><option value="Надбавка">{t("Надбавка")}</option></select></label>
            <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked />{t("Активная акция")}</label>
          </div>
          <div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={() => setAddOpen(false)} className="rounded px-4 py-2">{t("Отмена")}</button><button className="rounded bg-[#70cf88] px-5 py-2 font-semibold text-white">{t("Сохранить")}</button></div>
        </form>
      </div>}
    </main>
  );
}
