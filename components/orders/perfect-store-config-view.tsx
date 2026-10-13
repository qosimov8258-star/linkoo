"use client";

import { Plus, Search, Trash2, X } from "lucide-react";
import { FavoritesButton } from "@/components/dashboard/favorites-drawer";
import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";

type Config = { id: number; name: string; active: boolean };

export function PerfectStoreConfigView() {
  const { t } = useLanguage();
  const [items, setItems] = useState<Config[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const rows = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const add = () => {
    if (!name.trim()) return;
    setItems((previous) => [{ id: Date.now(), name: name.trim(), active }, ...previous]);
    setName(""); setActive(true); setOpen(false);
  };
  return (
    <main className="min-h-screen bg-[#f2f5f8] px-9 pb-12 pt-5 text-[#1b2a40]">
      <div className="mb-5 flex items-center justify-between"><h1 className="text-[26px] font-semibold text-[#586577]"><FavoritesButton className="mr-3 text-[#5a73e7]" /><span className="mr-3 text-slate-500">|</span>Perfect Store Config</h1><button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#71ce87] px-4 py-2.5 font-semibold text-white"><Plus size={18} /> {t("Добавить Config")}</button></div>
      <section className="min-h-[475px] bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-4"><label className="flex w-64 items-center border-b border-slate-300 py-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Поиск")} className="w-full outline-none" /><Search className="text-slate-300" /></label><span className="text-slate-500">1 - {rows.length || 0} {t("из")} {rows.length || 0}</span></div>
        <div className="grid grid-cols-[80px_1fr_220px] bg-[#5d6474] px-9 py-4 font-semibold text-white"><span>№</span><span>{t("Наименование")}</span><span>{t("Активный")}</span></div>
        {rows.length ? rows.map((row, index) => <div key={row.id} className="grid grid-cols-[80px_1fr_220px] items-center border-b border-dashed border-slate-200 px-9 py-4"><span>{index + 1}</span><span>{row.name}</span><span className="flex items-center justify-between"><button onClick={() => setItems((old) => old.map((item) => item.id === row.id ? { ...item, active: !item.active } : item))} className={`rounded-full px-3 py-1 text-sm font-semibold ${row.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{row.active ? t("Активный") : t("Неактивный")}</button><button onClick={() => setItems((old) => old.filter((item) => item.id !== row.id))}><Trash2 size={18} className="text-red-400" /></button></span></div>) : <div className="flex h-[355px] flex-col items-center justify-center"><img src="/robot-mascot.png" alt="" className="h-44 w-auto object-contain" /><p className="mt-3 text-slate-500">{t("По вашему запросу ничего не найдено")}</p></div>}
      </section>
      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={(e) => { e.preventDefault(); add(); }} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{t("Добавить Config")}</h2><button type="button" onClick={() => setOpen(false)}><X /></button></div><label className="block text-sm font-semibold">{t("Наименование")}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full border-b border-slate-300 p-2 outline-none" /></label><label className="mt-5 flex items-center gap-2"><input checked={active} onChange={(e) => setActive(e.target.checked)} type="checkbox" /> {t("Активный")}</label><button className="mt-6 w-full rounded bg-[#71ce87] py-3 font-semibold text-white">{t("Сохранить")}</button></form></div>}
    </main>
  );
}
