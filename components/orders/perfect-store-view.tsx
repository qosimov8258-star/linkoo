"use client";

import { Download } from "lucide-react";
import { FavoritesButton } from "@/components/dashboard/favorites-drawer";
import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";

const tabs = ["Не подтверждён", "Подтверждён", "Все"];

export function PerfectStoreView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("Все");
  const [date, setDate] = useState("2026-08-06");
  const [notice, setNotice] = useState("");

  const download = () => {
    const csv = "ID;Создал;Агент;Магазин;Дата создания;Присутствие;Доля;Задача;Комментарий;Статус задачи\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "perfect-store.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[#f3f6fa] px-9 pb-12 pt-5 text-[#1b2a40]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[26px] font-semibold text-[#586577]"><FavoritesButton className="mr-3 text-[#5a73e7]" /><span className="mr-3 text-slate-500">|</span>Perfect store</h1>
        <div className="flex gap-2">
          <button onClick={download} className="inline-flex items-center gap-2 rounded-md bg-[#70cf88] px-4 py-2.5 font-semibold text-white shadow-sm"><Download size={18} /> {t("Скачать Excel")}</button>
          <Link href="/analytics/perfect-store/config" className="rounded-md bg-[#526fdb] px-5 py-2.5 font-semibold text-white shadow-sm">{t("Конфигурация")}</Link>
        </div>
      </div>

      <section className="overflow-hidden rounded-md bg-white shadow-sm">
        <div className="grid grid-cols-3 border-b border-slate-200">
          {tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`h-16 text-[17px] ${tab === item ? "border-b-4 border-[#5874e3] font-medium" : "border-b-4 border-transparent"}`}>{t(item)}</button>)}
        </div>
        <div className="grid grid-cols-4 gap-3 px-3 py-5">
          <label className="border-b border-slate-200 px-3 pb-2 text-sm font-semibold">{t("Дата создания")}<input aria-label={t("Дата создания")} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 block w-full border-0 bg-transparent text-base font-normal outline-none" /></label>
          {["Создал", "Тип клиента", "Филиалы"].map((label) => <label key={label} className="mt-7 flex h-10 items-center justify-between border-b border-slate-200 px-1 font-semibold">{t(label)}<span className="text-slate-400">⌄</span></label>)}
          <button onClick={() => { setNotice(`${t("Фильтр применён")}: ${tab}`); window.setTimeout(() => setNotice(""), 2200); }} className="col-span-4 mt-2 h-12 rounded-md bg-[#70cf88] text-lg font-semibold text-white">{t("Применить")}</button>
        </div>
      </section>
      {notice && <p className="mt-2 text-center font-medium text-[#5171df]">{notice}</p>}

      <section className="mt-11 grid grid-cols-3 gap-5">
        <div className="min-h-[140px] bg-white px-5 py-4 shadow-sm"><p className="text-slate-500">{t("Кол-во магазинов")}</p><b>0</b><p className="mt-4 text-slate-500">{t("Кол-во perfect store")}</p><b>0</b></div>
        <div className="min-h-[140px] bg-white px-5 py-4 shadow-sm"><p className="text-slate-500">{t("Присутствие")}</p><b className="text-blue-700">0 %</b><p className="mt-4 text-slate-500">{t("Доля на полке")}</p><b className="text-blue-700">0 %</b></div>
        <div className="min-h-[140px] bg-white px-5 py-4 text-right shadow-sm"><p className="text-slate-500">{t("Задачи в ожидании")}</p><b>0</b><p className="mt-4 text-slate-500">{t("Сделанные задачи")}</p><b>0</b></div>
      </section>

      <section className="mt-5 overflow-hidden border border-slate-200 bg-white">
        <div className="grid grid-cols-10 bg-[#eef2f8] py-4 text-center text-sm font-semibold text-[#34496b]">
          {["ID", "Создал", "Агент", "Магазин", "Дата создания", "Присутствие", "Доля", "Задача", "Комментарий", "Статус задачи"].map((head) => <span key={head}>{t(head)}</span>)}
        </div>
        <div className="flex h-28 items-center justify-center text-slate-400">{t("Нет данных")}</div>
      </section>
    </main>
  );
}
