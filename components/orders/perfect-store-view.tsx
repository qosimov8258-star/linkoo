"use client";

import { Download } from "lucide-react";
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit";
import Link from "next/link";
import { useState } from "react";
import { csvText } from "@/lib/csv";
import { useLanguage } from "@/lib/i18n/language-context";

const tabs = ["Не подтверждён", "Подтверждён", "Все"];

export function PerfectStoreView() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("Все");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState("");

  const download = () => {
    const csv = csvText([["ID", "Создал", "Агент", "Магазин", "Дата создания", "Присутствие", "Доля", "Задача", "Комментарий", "Статус задачи"]]) + "\n";
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
        <RefTabs labels={tabs} value={tab} onChange={setTab} />
        <div className="grid grid-cols-4 gap-x-[15px] gap-y-2 px-[10px] py-[14px]">
          <label className="border-b border-[#d0d0d0] pb-1 text-[11px] font-semibold">{t("Дата создания")}<input aria-label={t("Дата создания")} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block w-full border-0 bg-transparent text-[13px] font-normal outline-none" /></label>
          {["Создал", "Тип клиента", "Филиалы"].map((label) => <label key={label} className="mt-[10px] flex h-[28px] items-center justify-between border-b border-[#d0d0d0] text-[13px] font-semibold">{t(label)}<span className="text-slate-400">⌄</span></label>)}
          <button onClick={() => { setNotice(`${t("Фильтр применён")}: ${tab}`); window.setTimeout(() => setNotice(""), 2200); }} className="col-span-4 mt-2 h-[30px] rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">{t("Применить")}</button>
        </div>
      </section>
      {notice && <p className="mt-2 text-center font-medium text-[#5171df]">{notice}</p>}

      <section className="mt-[24px] grid grid-cols-3 gap-[15px] text-[13px]">
        <div className="min-h-[100px] bg-white px-[10px] py-[8px] shadow-sm"><p className="text-slate-500">{t("Кол-во магазинов")}</p><b>0</b><p className="mt-2 text-slate-500">{t("Кол-во perfect store")}</p><b>0</b></div>
        <div className="min-h-[100px] bg-white px-[10px] py-[8px] shadow-sm"><p className="text-slate-500">{t("Присутствие")}</p><b className="text-blue-700">0 %</b><p className="mt-2 text-slate-500">{t("Доля на полке")}</p><b className="text-blue-700">0 %</b></div>
        <div className="min-h-[100px] bg-white px-[10px] py-[8px] text-right shadow-sm"><p className="text-slate-500">{t("Задачи в ожидании")}</p><b>0</b><p className="mt-2 text-slate-500">{t("Сделанные задачи")}</p><b>0</b></div>
      </section>

      <section className="mt-5 overflow-hidden border border-slate-200 bg-white">
        <div className="grid grid-cols-10 bg-[#f2f5f8] py-3 text-center text-[13px] font-semibold text-[#333]">
          {["ID", "Создал", "Агент", "Магазин", "Дата создания", "Присутствие", "Доля", "Задача", "Комментарий", "Статус задачи"].map((head) => <span key={head}>{t(head)}</span>)}
        </div>
        <div className="flex h-28 items-center justify-center text-slate-400">{t("Нет данных")}</div>
      </section>
    </RefPage>
  );
}
