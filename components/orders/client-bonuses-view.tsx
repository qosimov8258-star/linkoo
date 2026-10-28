"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit";
import { csvText } from "@/lib/csv";
import { todayIso } from "@/lib/finance/dates";
import { formatDateText } from "@/lib/i18n/format-date";
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

/** Points of a client kept in the bonus store (/api/ref-records/bonus, keyed by the client id). */
type StoredBonus = { id: number | string; points?: unknown; lastScore?: unknown };

/** Saves a client's points: updates its bonus record, or creates it on the first score. */
async function saveBonus(client: { id: number; name: string }, patch: { points: number; lastScore: string }): Promise<boolean> {
  const update = await fetch(`/api/ref-records/bonus/${client.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (update.status !== 404) return update.ok;
  const create = await fetch("/api/ref-records/bonus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: client.id, name: client.name, ...patch }),
  });
  return create.ok;
}

export function ClientBonusesView() {
  const { t, language } = useLanguage();
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

  useEffect(() => {
    let cancelled = false;
    // Every real client is listed; the points saved in the bonus store are laid over it by client id.
    const list = <T,>(url: string) =>
      fetch(url, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : []))
        .then((data: unknown) => (Array.isArray(data) ? (data as T[]) : []))
        .catch(() => [] as T[]);
    Promise.all([list<{ id: number; name: string }>("/api/clients?balances=0"), list<StoredBonus>("/api/ref-records/bonus")]).then(([rows, bonuses]) => {
      if (cancelled) return;
      const stored = new Map(bonuses.map((bonus) => [String(bonus.id), bonus]));
      setClients(
        rows
          .slice()
          .sort((a, b) => b.id - a.id)
          .map((client) => {
            const bonus = stored.get(String(client.id));
            const points = typeof bonus?.points === "number" && Number.isFinite(bonus.points) ? bonus.points : 0;
            const lastScore = typeof bonus?.lastScore === "string" && bonus.lastScore ? bonus.lastScore : "Не получатель";
            return { id: client.id, name: client.name, points, lastScore, history: [] };
          }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const paging = usePaging(0);

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
        formatDateText(client.lastScore, language),
      ]),
    ];
    const content = csvText(rows);
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
      date: todayIso(),
      points,
    };

    const nextPoints = (clients.find((client) => client.id === bonusClient.id)?.points ?? bonusClient.points) + points;
    void saveBonus(bonusClient, { points: nextPoints, lastScore: entry.date })
      .catch(() => false)
      .then((saved) => {
        if (!saved) setNotice(t("Не удалось сохранить изменения на сервере"));
      });
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

  const pageCount = Math.max(1, Math.ceil(filteredClients.length / paging.pageSize));
  const currentPage = Math.min(paging.page, pageCount);
  const startIndex = (currentPage - 1) * paging.pageSize;
  const pagedClients = filteredClients.slice(startIndex, startIndex + paging.pageSize);

  return (
    <RefPage>
      <input ref={importRef} className="hidden" type="file" accept=".csv,text/csv" onChange={importCsv} />

      <RefHeader title={t("Бонусы клиентов")}>
        <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => importRef.current?.click()} />
      </RefHeader>

      {notice && (
        <div className="mb-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-[13px] text-[#278549]">
          {notice}
          <button onClick={() => setNotice("")} aria-label={t("Закрыть уведомление")}>
            <X size={17} />
          </button>
        </div>
      )}

      <RefCard>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <div className="flex w-[520px] flex-wrap items-center gap-3 border border-slate-200 bg-white p-4 text-[13px] shadow-xl">
              <span className="font-semibold">{t("Фильтр по баллам:")}</span>
              {[
                ["all", "Все клиенты"],
                ["positive", "Положительный балл"],
                ["zero", "Без баллов"],
                ["negative", "Минусовой балл"],
              ].map(([value, label]) => (
                <label key={value} className="inline-flex cursor-pointer items-center gap-2">
                  <input type="radio" name="score-filter" checked={draftFilter === value} onChange={() => setDraftFilter(value as typeof draftFilter)} />
                  {t(label)}
                </label>
              ))}
              <button onClick={applyFilter} className="h-[30px] rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white uppercase">
                {t("Применить")}
              </button>
            </div>
          }
          query={search}
          onQuery={(value) => {
            setSearch(value);
            paging.setPage(1);
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filteredClients.length ? startIndex + 1 : 0}
          to={Math.min(startIndex + paging.pageSize, filteredClients.length)}
          total={filteredClients.length}
          page={currentPage}
          pageCount={pageCount}
          onPage={paging.setPage}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={exportCsv} />}
        />

        <RefTable
          cols="minmax(0,1fr) minmax(0,6fr) minmax(0,2fr) minmax(0,3fr)"
          heads={[t("№"), t("Наименование"), t("Балл"), t("Дата последнего бала")]}
          rows={pagedClients}
          rowKey={(client) => client.id}
          onRowClick={(client) => setSelectedClient(client)}
          empty={t("Ничего не найдено")}
          render={(client) => [
            client.id,
            client.name,
            <span key="p">{client.points}</span>,
            <span key="last" className="flex items-center">
              <span>{formatDateText(client.lastScore, language)}</span>
              <button
                title={t("Добавить балл")}
                onClick={(event) => {
                  event.stopPropagation();
                  setBonusClient(client);
                  setBonusKind("minus");
                  setFormError("");
                }}
                className="ml-auto mr-[72px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#71ce87] text-white"
              >
                <Plus size={14} strokeWidth={3} />
              </button>
            </span>,
          ]}
        />
      </RefCard>

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
                      <td className="px-9 py-4">{formatDateText(entry.date, language)}</td>
                      <td className={`px-9 py-4 font-semibold ${entry.points < 0 ? "text-[#e46666]" : "text-[#42a75b]"}`}>{entry.points}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#7e8792]">
                        <img src="/robot-empty.png" alt="" className="mx-auto mb-3 h-48 w-48 object-contain" />
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
    </RefPage>
  );
}
