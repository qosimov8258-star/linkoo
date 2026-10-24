"use client";

import { Download } from "lucide-react";
import { RefHeader, RefPage } from "@/components/ref/list-kit";
import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";

const tabs = ["Не подтверждён", "Подтверждён", "Все"];

export function PerfectStoreView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("Все");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState("");
  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).replace(" г.", "");

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
    <RefPage>
      <RefHeader title="Perfect store">
        <button onClick={download} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Download size={16} /> {t("Скачать Excel")}</button>
        <Link href="/analytics/perfect-store/config" className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Конфигурация")}</Link>
      </RefHeader>

      <section className="overflow-hidden bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[52px] border-b border-[#e5e8ed]">
          {tabs.map((label) => (
            <button key={label} type="button" onClick={() => setTab(label)} className={`relative h-full flex-1 text-[13px] ${tab === label ? "text-[#333]" : "text-[#333]"}`}>
              {t(label)}
              {tab === label && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#4f71dc]" />}
            </button>
          ))}
        </div>
        <div className="px-[10px] pb-[11px] pt-[16px]">
          <div className="grid grid-cols-[344px_343px_343px_343px] gap-x-[10px] pl-[10px]">
            <label className="relative mt-[2px] block h-[40px] w-[256px] border-b border-[#d5dae1]">
              <span className="absolute left-0 top-[2px] flex items-center gap-[4px] text-[9px] font-semibold leading-[11px]">
                {t("Дата создания")}
                <svg viewBox="0 0 24 24" className="h-[12px] w-[12px] fill-[#c4c8d0]" aria-hidden><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" /></svg>
              </span>
              <span className="absolute bottom-[3px] left-0 text-[13px]">{displayDate}</span>
              <input aria-label={t("Дата создания")} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
            {["Создал", "Тип клиента", "Филиалы"].map((label) => (
              <div key={label} className="mt-[11px] flex h-[31px] items-end justify-between border-b border-[#d5dae1] pb-[5px] text-[13px] font-semibold">
                {t(label)}
                <span className="mb-[3px] border-x-[5px] border-t-[5px] border-x-transparent border-t-[#888]" aria-hidden />
              </div>
            ))}
          </div>
          <button onClick={() => { setNotice(`${t("Фильтр применён")}: ${tab}`); window.setTimeout(() => setNotice(""), 2200); }} className="mt-[27px] h-[36px] w-full rounded-[3px] bg-[#71ce87] text-[13px] font-bold text-white hover:brightness-95">{t("Применить")}</button>
        </div>
      </section>
      {notice && <p className="mt-2 text-center font-medium text-[#5171df]">{notice}</p>}

      <section className="mt-[34px] grid grid-cols-3 gap-[16px] text-[13px]">
        <div className="h-[114px] bg-white px-[16px] pt-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.1)]"><p className="leading-[18px] text-[#5d6474]">{t("Кол-во магазинов")}</p><b className="mt-[4px] block leading-[18px]">0</b><p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Кол-во perfect store")}</p><b className="mt-[4px] block leading-[18px]">0</b></div>
        <div className="h-[114px] bg-white px-[16px] pt-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.1)]"><p className="leading-[18px] text-[#5d6474]">{t("Присутствие")}</p><b className="mt-[4px] block leading-[18px] text-[#0000ee]">0 %</b><p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Доля на полке")}</p><b className="mt-[4px] block leading-[18px] text-[#0000ee]">0 %</b></div>
        <div className="h-[114px] bg-white px-[16px] pt-[10px] text-right shadow-[0_1px_4px_rgba(0,0,0,0.1)]"><p className="leading-[18px] text-[#5d6474]">{t("Задачи в ожидании")}</p><b className="mt-[4px] block leading-[18px]">0</b><p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Сделанные задачи")}</p><b className="mt-[4px] block leading-[18px]">0</b></div>
      </section>

      <section className="relative mt-[17px] border border-[#e1e5ea] bg-white">
        <div className="grid h-[30px] grid-cols-[100px_repeat(9,minmax(0,1fr))] items-center bg-[#f0f3f6] text-center text-[13px] font-semibold text-[#333] shadow-[0_2px_4px_rgba(0,0,0,0.12)]">
          {["ID", "Создал", "Агент", "Магазин", "Дата создания", "Присутствие", "Доля", "Задача", "Комментарий", "Статус задачи"].map((head) => <span key={head}>{t(head)}</span>)}
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className={`grid h-[31px] grid-cols-[100px_repeat(9,minmax(0,1fr))] border-t border-[#e9edf1] ${row === 1 ? "bg-[#f5f7fa]" : ""}`}>
            {Array.from({ length: 10 }).map((_, col) => <span key={col} className="border-l border-[#e9edf1] first:border-l-0" />)}
          </div>
        ))}
        <span className="absolute left-1/2 top-[52px] -translate-x-1/2 bg-white px-[20px] py-[9px] text-[13px] text-[#8390a4]">{t("Нет данных")}</span>
      </section>
    </RefPage>
  );
}
