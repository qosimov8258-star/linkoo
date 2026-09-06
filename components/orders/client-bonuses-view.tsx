"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { FavoritesButton } from "@/components/dashboard/favorites-drawer";
import { useLanguage } from "@/lib/i18n/language-context";

type BonusEntry = {
  product: string;
  quantity: string;
  order: string;
  type: string;
  promotion: string;
  date: string;
  points: number;
};

type BonusClient = {
  id: number;
  name: string;
  points: number;
  lastScore: string;
  history: BonusEntry[];
};

const initialClients: BonusClient[] = [];

const dateLabel = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function ClientBonusesView() {
  const { t } = useLanguage();
  const [clients, setClients] = useState(initialClients);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<"all" | "positive" | "zero" | "negative">("all");
  const [draftFilter, setDraftFilter] = useState(scoreFilter);
  const [selectedClient, setSelectedClient] = useState<BonusClient | null>(null);
  const [bonusClient, setBonusClient] = useState<BonusClient | null>(null);
  const [bonusKind, setBonusKind] = useState<"plus" | "minus">("minus");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch =
        !query ||
        client.name.toLowerCase().includes(query) ||
        String(client.id).includes(query);
      const matchesScore =
        scoreFilter === "all" ||
        (scoreFilter === "positive" && client.points > 0) ||
        (scoreFilter === "zero" && client.points === 0) ||
        (scoreFilter === "negative" && client.points < 0);
      return matchesSearch && matchesScore;
    });
  }, [clients, scoreFilter, search]);

  const activeClient = selectedClient
    ? clients.find((client) => client.id === selectedClient.id) ?? null
    : null;

  function applyFilter() {
    setScoreFilter(draftFilter);
    setFilterOpen(false);
  }

  function exportCsv() {
    const rows = [
      [t("№"), t("Наименование"), t("Балл"), t("Дата последнего бала")],
      ...filteredClients.map((client) => [
        String(client.id),
        client.name,
        String(client.points),
        client.lastScore,
      ]),
    ];
    const content = rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bonusy-klientov.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(t("Файл Excel/CSV скачан"));
  }

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split(/\r?\n/).filter(Boolean).slice(1);
      const imported = new Map(
        lines.map((line) => {
          const values = line.replace(/"/g, "").split(/[;,]/).map((value) => value.trim());
          return [Number(values[0]), values] as const;
        }),
      );
      let changed = 0;
      setClients((current) =>
        current.map((client) => {
          const values = imported.get(client.id);
          if (!values || Number.isNaN(Number(values[2]))) return client;
          changed += 1;
          return {
            ...client,
            points: Number(values[2]),
            lastScore: values[3] || client.lastScore,
          };
        }),
      );
      setNotice(changed ? `${t("Импортировано записей")}: ${changed}` : t("Файл обработан: подходящих клиентов не найдено"));
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function submitBonus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bonusClient) return;
    const form = new FormData(event.currentTarget);
    const promotion = String(form.get("promotion") ?? "").trim();
    const comment = String(form.get("comment") ?? "").trim();
    const amount = Number(form.get("points"));

    if (!promotion || !comment || !Number.isFinite(amount) || amount <= 0) {
      setFormError(t("Заполните все обязательные поля и укажите балл больше нуля."));
      return;
    }

    const points = bonusKind === "plus" ? amount : -amount;
    const entry: BonusEntry = {
      product: "Ручное начисление",
      quantity: "—",
      order: "—",
      type: bonusKind === "plus" ? "Плюсовой балл" : "Минусовой балл",
      promotion,
      date: dateLabel.format(new Date()),
      points,
    };

    setClients((current) =>
      current.map((client) =>
        client.id === bonusClient.id
          ? {
              ...client,
              points: client.points + points,
              lastScore: entry.date,
              history: [entry, ...client.history],
            }
          : client,
      ),
    );
    setNotice(`${t("Баллы для")} «${bonusClient.name}» ${t("обновлены")}`);
    setBonusClient(null);
    setFormError("");
  }

  return (
    <main className="min-h-screen bg-[#f2f5f9] px-9 pb-12 pt-5 text-[#233047]">
      <input ref={importRef} className="hidden" type="file" accept=".csv,text/csv" onChange={importCsv} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[27px] font-bold text-[#5d687b]">
          <FavoritesButton className="text-[#4d6fe2]" />
          <span className="mx-3 text-[#667184]">|</span>
          {t("Бонусы клиентов")}
        </h1>
        <button
          onClick={() => importRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md bg-[#5273df] px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-[#4264d0]"
        >
          <Upload size={19} />
          {t("Импортировать")}
        </button>
      </div>

      {notice && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-[#b6dfbf] bg-[#effaf1] px-4 py-2 text-sm text-[#368c4e]">
          {notice}
          <button onClick={() => setNotice("")} aria-label={t("Закрыть уведомление")}>
            <X size={17} />
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-sm bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b border-[#e0e4eb] px-2 py-3">
          <button
            onClick={() => setFilterOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-[#5273df] px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-[#4264d0]"
          >
            <Filter size={18} />
            {t("Показать фильтр")}
          </button>

          <label className="mx-auto flex w-full max-w-[380px] items-center border-b border-[#d9dfe8] px-1 py-1 text-[#7c8799] sm:w-[380px]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full bg-transparent text-[16px] outline-none placeholder:text-[#b3bcc9]"
            />
            <Search size={25} className="text-[#b5bdc8]" />
          </label>

          <div className="ml-auto flex items-center gap-4 whitespace-nowrap text-[#596477]">
            <span>25⌄</span>
            <span>1 - {Math.min(25, filteredClients.length)} {t("из")} {filteredClients.length}</span>
            <ChevronLeft className="rounded-full border border-[#b5bdc8] p-0.5" size={25} />
            <ChevronRight className="rounded-full border border-[#8b95a5] p-0.5" size={25} />
            <button onClick={exportCsv} title={t("Скачать Excel/CSV")} className="text-[#616c7b] hover:text-[#5273df]">
              <Download size={28} />
            </button>
          </div>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-3 border-b border-[#e0e4eb] bg-[#f8fafc] px-5 py-3">
            <span className="font-semibold">{t("Фильтр по баллам:")}</span>
            {[
              ["all", "Все клиенты"],
              ["positive", "Положительный балл"],
              ["zero", "Без баллов"],
              ["negative", "Минусовой балл"],
            ].map(([value, label]) => (
              <label key={value} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="score-filter"
                  checked={draftFilter === value}
                  onChange={() => setDraftFilter(value as typeof draftFilter)}
                />
                {t(label)}
              </label>
            ))}
            <button onClick={applyFilter} className="rounded bg-[#70cf88] px-4 py-2 text-sm font-bold text-white">
              {t("Применить")}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead className="bg-[#626d82] text-white">
              <tr>
                <th className="px-9 py-4 font-bold">{t("№")}</th>
                <th className="px-9 py-4 font-bold">{t("Наименование")}</th>
                <th className="px-9 py-4 font-bold">{t("Балл")}</th>
                <th className="px-9 py-4 font-bold">{t("Дата последнего бала")}</th>
                <th className="w-24 px-4 py-4" aria-label={t("Действия")} />
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  className="cursor-pointer border-b-2 border-dotted border-[#dce4ec] bg-white transition hover:bg-[#f2f6ff]"
                >
                  <td className="px-9 py-4">{client.id}</td>
                  <td className="px-9 py-4 text-[17px]">{client.name}</td>
                  <td className={`px-9 py-4 text-[17px] ${client.points < 0 ? "text-[#e46666]" : ""}`}>{client.points}</td>
                  <td className="px-9 py-4 text-[17px]">{client.lastScore}</td>
                  <td className="px-4 py-4 text-center">
                    <button
                      title={t("Добавить балл")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setBonusClient(client);
                        setBonusKind("minus");
                        setFormError("");
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#88c56f] text-white hover:bg-[#70b25a]"
                    >
                      <Plus size={17} strokeWidth={3} />
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredClients.length && (
                <tr>
                  <td colSpan={5} className="px-8 py-16 text-center text-[#8b95a5]">{t("Ничего не найдено")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {bonusClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e1727]/60 p-4">
          <form onSubmit={submitBonus} className="w-full max-w-[375px] overflow-hidden bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e6e8ec] px-9 py-6">
              <h2 className="text-[18px] font-bold">{t("ДОБАВИТЬ БАЛЛ")}</h2>
              <button type="button" onClick={() => setBonusClient(null)} className="text-[#636363]"><X size={28} /></button>
            </div>
            <div className="space-y-7 px-6 py-8">
              <div className="space-y-4">
                <label className="flex items-center gap-4 text-[16px]">
                  <input type="radio" checked={bonusKind === "plus"} onChange={() => setBonusKind("plus")} className="h-6 w-6 accent-[#657185]" />
                  {t("Плюсовой балл")}
                </label>
                <label className="flex items-center gap-4 text-[16px]">
                  <input type="radio" checked={bonusKind === "minus"} onChange={() => setBonusKind("minus")} className="h-6 w-6 accent-[#657185]" />
                  {t("Минусовой балл")}
                </label>
              </div>
              <label className="block border-b border-[#d9dfe7] pb-2">
                <span className="block font-bold">{t("Акция")} <b className="text-[#fa7777]">*</b></span>
                <input name="promotion" placeholder={t("Выберите акцию")} className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-[#b7bfca]" />
              </label>
              <label className="block border-b border-[#d9dfe7] pb-2">
                <span className="block font-bold">{t("Балл")} <b className="text-[#fa7777]">*</b></span>
                <input name="points" type="number" min="1" placeholder={t("Введите количество")} className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-[#b7bfca]" />
              </label>
              <label className="block border-b border-[#d9dfe7] pb-2">
                <span className="block font-bold">{t("Оставить комментарий...")} <b className="text-[#fa7777]">*</b></span>
                <input name="comment" placeholder={t("Комментарий")} className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-[#b7bfca]" />
              </label>
              {formError && <p className="text-sm text-[#e46666]">{formError}</p>}
            </div>
            <div className="border-t border-[#e6e8ec] px-8 py-6 text-right">
              <button type="submit" className="font-bold text-[#149bd7] hover:text-[#0b7eaf]">{t("ДОБАВИТЬ")}</button>
            </div>
          </form>
        </div>
      )}

      {activeClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e1727]/60 p-4">
          <div className="w-full max-w-5xl overflow-hidden bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#e6e8ec] px-9 py-6">
              <h2 className="text-[18px] font-bold uppercase">{activeClient.name}</h2>
              <button onClick={() => setSelectedClient(null)} className="text-[#636363]"><X size={28} /></button>
            </div>
            <div className="min-h-[330px] overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="border-b-2 border-dotted border-[#dce4ec] text-[#4b4b4b]">
                    {["Продукт", "Кол-во", "Заказ", "Тип", "Акция", "Дата", "Балл"].map((heading) => (
                      <th key={heading} className="px-9 py-4 font-semibold">{t(heading)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeClient.history.length ? activeClient.history.map((entry, index) => (
                    <tr key={index} className="border-b-2 border-dotted border-[#dce4ec]">
                      <td className="px-9 py-4">{t(entry.product)}</td>
                      <td className="px-9 py-4">{entry.quantity}</td>
                      <td className="px-9 py-4">{entry.order}</td>
                      <td className="px-9 py-4">{t(entry.type)}</td>
                      <td className="px-9 py-4">{entry.promotion}</td>
                      <td className="px-9 py-4">{entry.date}</td>
                      <td className={`px-9 py-4 font-semibold ${entry.points < 0 ? "text-[#e46666]" : "text-[#42a75b]"}`}>{entry.points}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#7e8792]">
                        <img src="/robot-mascot.png" alt="" className="mx-auto mb-3 h-48 w-48 object-contain" />
                        {t("У этого клиента нету бонусов")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-4 border-t border-[#e6e8ec] px-8 py-4 text-[#687385]">
              <span>25⌄</span><span>1 - {activeClient.history.length} {t("из")} {activeClient.history.length}</span>
              <ChevronLeft className="rounded-full border border-[#b5bdc8] p-0.5" size={25} />
              <ChevronRight className="rounded-full border border-[#8b95a5] p-0.5" size={25} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
