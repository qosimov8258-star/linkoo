"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { SortHead, sortByOrdering, toggleOrdering } from "@/components/analytics/list-url-state";
import { RI, RefAppliedFilter, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefImportDialog, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit";
import { readExcelRows } from "@/lib/excel-import";
import { downloadExcelTable } from "@/lib/excel-export";
import { formatDateText } from "@/lib/i18n/format-date";
import { useLanguage } from "@/lib/i18n/language-context";
import { notify } from "@/lib/notify";
import { strictNumber } from "@/lib/strict-number";

import { KitSearchSelect, type KitOption } from "./field-filter-kit";
import { queryInt, useLinkoUrlState } from "./linko-url-state";

// Продажи → «Бонусы клиентов» (Linko #/client-bonuses, API sales/client_promotion/): one row per client (financial
// account) with its points and the day of its last score, newest first. The URL keeps the list state with Linko's names
// (pageSize, page, search, ordering, openFilterDialog, responsibleAgent, promotion, excelImport; the opened client is
// the path: /analytics/client-bonuses/<id> = #/client-bonuses/<id>, its history dialog with dPage / dPageSize). Data:
// lib/client-bonuses-repo.ts.

type BonusRow = { id: number; name: string; ball: number; lastCreated: string | null };
type Entry = {
  id: number;
  type: string;
  productName: string;
  comment: string;
  amount: number;
  orderId: number | null;
  promotionName: string;
  ball: number;
  createdAt: string;
};
type Named = { id: number; name: string };

const BASE = "/analytics/client-bonuses";
const ORDERINGS = ["id", "ball", "last_created"] as const;
const GREEN = "#81c784";
const RED = "#e57373";
const ADD_ICON = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z";
const CLOSE_ICON = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

/** Linko's labels of an entry's type (its own wording); any other type is a hand score. */
const TYPE_LABEL: Record<string, string> = { delivered: "Доставлен", order_return_accept: "Возврать", order_prize: "Призавой заказ" };

/** "10 000 050", "-155", "1,5": spaces between thousands, a decimal comma, no trailing zeros. */
function formatBall(value: number): string {
  const sign = value < 0 ? "-" : "";
  const [int, frac] = String(Math.round(Math.abs(value) * 1e5) / 1e5).split(".");
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${frac ? `,${frac}` : ""}`;
}

const getJson = <T,>(url: string, fallback: T): Promise<T> =>
  fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<T>) : fallback))
    .catch(() => fallback);

/** A refusal's message (a Russian i18n key) of a failed write. */
async function refusal(response: Response): Promise<{ error: string; field: string | null }> {
  const data = (await response.json().catch(() => null)) as { error?: unknown; field?: unknown } | null;
  return {
    error: typeof data?.error === "string" && data.error ? data.error : "Не удалось сохранить изменения на сервере",
    field: typeof data?.field === "string" ? data.field : null,
  };
}

export function ClientBonusesView() {
  const { t, language } = useLanguage();
  const { state, ready, update } = useLinkoUrlState(BASE);
  const query = state.query;
  const pageSize = queryInt(query.pageSize, 25);
  const search = query.search ?? "";
  const ordering = useMemo(() => (query.ordering ?? "").split(",").filter((item) => (ORDERINGS as readonly string[]).includes(item.replace(/^-/, ""))), [query.ordering]);
  const agent = query.responsibleAgent && /^\d+$/.test(query.responsibleAgent) ? query.responsibleAgent : "";
  const promotion = query.promotion && /^\d+$/.test(query.promotion) ? query.promotion : "";
  const filterOpen = query.openFilterDialog === "true";
  const importOpen = query.excelImport === "true";
  const detailId = state.id && /^\d+$/.test(state.id) ? Number(state.id) : null;

  const [rows, setRows] = useState<BonusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [employees, setEmployees] = useState<Named[]>([]);
  const [promotions, setPromotions] = useState<Named[]>([]);
  const [draft, setDraft] = useState({ agent: "", promotion: "" });
  const [addFor, setAddFor] = useState<BonusRow | null>(null);

  useEffect(() => {
    void getJson<{ id: number; name?: string; active?: boolean }[]>("/api/employees", []).then((list) =>
      setEmployees((Array.isArray(list) ? list : []).filter((row) => row.active !== false).map((row) => ({ id: row.id, name: row.name ?? "" })).filter((row) => row.name)),
    );
    void getJson<Named[]>("/api/client-bonuses/promotions", []).then((list) => setPromotions(Array.isArray(list) ? list : []));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    void getJson<BonusRow[]>(`/api/client-bonuses${agent ? `?responsibleAgent=${agent}` : ""}`, []).then((list) => {
      if (cancelled) return;
      setRows(Array.isArray(list) ? list : []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agent, ready, reloadKey]);

  // Linko's search answers 500 (nothing is listed); here it finds a client by name or number.
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const found = needle ? rows.filter((row) => row.name.toLocaleLowerCase().includes(needle) || String(row.id).includes(needle)) : rows;
    return sortByOrdering(found, ordering, {
      id: (a, b) => a.id - b.id,
      ball: (a, b) => a.ball - b.ball,
      // Never scored ("Не получатель") comes last ascending and first descending, as Linko's Postgres orders a NULL.
      last_created: (a, b) => (a.lastCreated === b.lastCreated ? 0 : a.lastCreated === null ? 1 : b.lastCreated === null ? -1 : a.lastCreated.localeCompare(b.lastCreated)),
    });
  }, [ordering, rows, search]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Math.min(queryInt(query.page, 1, 1e9), pageCount);
  const start = (page - 1) * pageSize;
  const pageRows = visible.slice(start, start + pageSize);
  const filterCount = (agent ? 1 : 0) + (promotion ? 1 : 0);

  const employeeOptions: KitOption[] = useMemo(() => employees.map((row) => ({ value: String(row.id), label: row.name })), [employees]);
  const promotionOptions: KitOption[] = useMemo(() => promotions.map((row) => ({ value: String(row.id), label: row.name })), [promotions]);

  const openFilter = () => {
    setDraft({ agent, promotion });
    update({ query: { openFilterDialog: "true" } });
  };
  const sort = (field: string) => update({ query: { ordering: toggleOrdering(ordering, field).join(","), page: null } });

  function downloadExcel() {
    // Linko's grid exports the rows of the page on screen.
    downloadExcelTable(t("Бонусы клиентов"), [
      [t("№"), t("Наименование"), t("Балл"), t("Дата последнего бала")],
      ...pageRows.map((row) => [row.id, row.name, formatBall(row.ball) || "0", row.lastCreated ? formatDateText(row.lastCreated.slice(0, 10), language) : null]),
    ], { blankNulls: true });
  }

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return (
    <RefPage>
      <RefHeader title={t("Бонусы клиентов")}>
        <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => update({ query: { excelImport: "true" } })} />
      </RefHeader>

      <RefCard>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => (filterOpen ? update({ query: { openFilterDialog: "false" } }) : openFilter())}
          leftSlot={!filterOpen && filterCount > 0 ? <RefAppliedFilter count={filterCount} width={371.5} shift={30} onEdit={openFilter} onClear={() => update({ query: { responsibleAgent: null, promotion: null, page: null } })} /> : undefined}
          filterPanel={
            <RefFilterPanel
              narrow
              className="!w-[300px]"
              applyClassName="mt-[15px]"
              onClose={() => update({ query: { openFilterDialog: "false" } })}
              onApply={() => update({ query: { openFilterDialog: "false", responsibleAgent: draft.agent || null, promotion: draft.promotion || null, page: null } })}
            >
              <div className="flow-root h-[62px]">
                <KitSearchSelect label="Ответственный агент" options={employeeOptions} value={draft.agent} onChange={(value) => setDraft((current) => ({ ...current, agent: value }))} />
              </div>
              <div className="flow-root h-[62px]">
                <KitSearchSelect label="Акция" options={promotionOptions} value={draft.promotion} onChange={(value) => setDraft((current) => ({ ...current, promotion: value }))} />
              </div>
            </RefFilterPanel>
          }
          query={search}
          onQuery={(value) => update({ query: { search: value, page: null } })}
          pageSize={pageSize}
          onPageSize={(size) => update({ query: { pageSize: size, page: null } })}
          from={visible.length ? start + 1 : 0}
          to={Math.min(start + pageSize, visible.length)}
          total={visible.length}
          page={page}
          pageCount={pageCount}
          onPage={(next) => update({ query: { page: next > 1 ? next : null } })}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadExcel} />}
        />

        <RefTable
          cols="minmax(0,1fr) minmax(0,6fr) minmax(0,2fr) minmax(0,3fr)"
          heads={[
            <SortHead key="id" label={t("№")} field="id" ordering={ordering} onSort={sort} className="-ml-2" />,
            <span key="name">{t("Наименование")}</span>,
            <SortHead key="ball" label={t("Балл")} field="ball" ordering={ordering} onSort={sort} />,
            <SortHead key="last" label={t("Дата последнего бала")} field="last_created" ordering={ordering} onSort={sort} />,
          ]}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => update({ id: String(row.id), query: { dPage: null, dPageSize: null } })}
          empty={loading ? "" : t("По вашему запросу ничего не найдено")}
          render={(row) => [
            <span key="id" className="-ml-2">{row.id}</span>,
            row.name,
            formatBall(row.ball),
            <span key="last" className="-mx-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center">
              <span className="pl-2">{row.lastCreated ? formatDateText(row.lastCreated.slice(0, 10), language) : t("Не получатель")}</span>
              <span className="pl-2">
                <button
                  type="button"
                  title={t("Добавить / Минусовать балл")}
                  aria-label={t("Добавить / Минусовать балл")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAddFor(row);
                  }}
                  className="flex h-[30px] w-[30px] items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" style={{ fill: "#8dc572" }} aria-hidden>
                    <path d={ADD_ICON} />
                  </svg>
                </button>
              </span>
            </span>,
          ]}
        />
      </RefCard>

      {detailId !== null && (
        <HistoryDialog
          clientId={detailId}
          promotion={promotion}
          reloadKey={reloadKey}
          page={queryInt(query.dPage, 1, 1e9)}
          pageSize={queryInt(query.dPageSize, 25)}
          onPage={(next) => update({ query: { dPage: next > 1 ? next : null } })}
          onPageSize={(size) => update({ query: { dPageSize: size, dPage: null } })}
          onClose={() => update({ id: null, query: { dPage: null, dPageSize: null } })}
        />
      )}

      {addFor && (
        <AddBallDialog
          client={addFor}
          promotions={promotionOptions}
          onClose={() => setAddFor(null)}
          onSaved={() => {
            setAddFor(null);
            reload();
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          promotions={promotionOptions}
          templateRows={visible.slice().sort((a, b) => b.id - a.id)}
          onClose={() => update({ query: { excelImport: "false" } })}
          onSaved={() => {
            // Linko closes the dialog and refreshes the list, without a message.
            update({ query: { excelImport: "false" } });
            reload();
          }}
        />
      )}
    </RefPage>
  );
}

/** Linko's material dialog frame: a white sheet near the top of a dimmed page. */
function DialogFrame({ width, onClose, children, center }: { width: number; onClose: () => void; children: React.ReactNode; /** Vertically centred (Linko's history dialog); else 64px from the top. */ center?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-[80] flex justify-center overflow-y-auto bg-black/[0.54] px-4 pb-16 pt-16 ${center ? "items-center" : "items-start"}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="max-w-full bg-white text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]" style={{ width }}>
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button type="button" onClick={onClick} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
        <path d={CLOSE_ICON} />
      </svg>
    </button>
  );
}

/** The client's history (Linko's subList dialog, 1000px): Продукт · Кол-во · Заказ · Тип · Акция · Дата · Балл. */
function HistoryDialog({
  clientId,
  promotion,
  reloadKey,
  page,
  pageSize,
  onPage,
  onPageSize,
  onClose,
}: {
  clientId: number;
  promotion: string;
  reloadKey: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<{ client: Named | null; entries: Entry[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void getJson<{ client?: Named; entries?: Entry[] } | null>(`/api/client-bonuses/${clientId}/entries${promotion ? `?promotion=${promotion}` : ""}`, null).then((result) => {
      if (!cancelled) setData({ client: result?.client ?? null, entries: Array.isArray(result?.entries) ? result.entries : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, promotion, reloadKey]);

  const entries = data?.entries ?? [];
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.min(page, pageCount);
  const shown = entries.slice((current - 1) * pageSize, current * pageSize);
  const grid = "-mx-2 grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)] items-center";
  const dotted = "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']";

  return (
    <DialogFrame width={1000} onClose={onClose} center>
      <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
        <b className="font-bold uppercase">{data?.client?.name ?? ""}</b>
        <CloseButton onClick={onClose} />
      </div>
      {data === null ? (
        <div className="flex h-[400px] items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#e0e0e0] border-t-[#1E4A9A]" />
        </div>
      ) : (
        <>
          <div className="max-h-[500px] overflow-y-auto px-[30px]">
            <div className={`${grid} ${dotted} py-[15px] font-semibold`}>
              {["Продукт", "Кол-во", "Заказ", "Тип", "Акция", "Дата", "Балл"].map((head, index) => (
                <span key={head} className={`px-2 ${index === 6 ? "text-right" : ""}`}>{t(head)}</span>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="mb-[15px] bg-[url('/robot-empty.png')] bg-[length:200px] bg-center bg-no-repeat pt-[200px] text-center text-[#666]">{t("У этого клиента нету бонусов")}</div>
            ) : (
              shown.map((entry, index) => (
                <div key={entry.id} className={`${grid} ${index < shown.length - 1 ? dotted : ""} py-[15px]`}>
                  <span className="px-2">{entry.productName || entry.comment}</span>
                  <span className="px-2">{formatBall(entry.amount)}</span>
                  <span className="px-2">{entry.orderId ?? ""}</span>
                  <span className="px-2">{t(TYPE_LABEL[entry.type] ?? "Индивидуальный")}</span>
                  <span className="px-2">{entry.promotionName || t("Не выбрано")}</span>
                  <span className="px-2">{formatDateText(entry.createdAt.slice(0, 16), language, { withTime: true })}</span>
                  <span className="px-2 text-right font-semibold" style={{ color: entry.ball > 0 ? GREEN : entry.ball < 0 ? RED : undefined, fontWeight: entry.ball === 0 ? 400 : 600 }}>
                    {formatBall(entry.ball)}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex h-[50px] items-center justify-end border-t border-[#efefef] px-[30px] text-[#5d6474]">
            <div className="relative mr-[27px]">
              <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label={t("Количество строк")} className="h-12 w-[40px] appearance-none bg-transparent text-[13px] text-[#333] outline-none">
                {[10, 25, 50, 100].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
            </div>
            <span className="mr-[5px] whitespace-nowrap">{entries.length ? (current - 1) * pageSize + 1 : 1} - {Math.min(current * pageSize, entries.length)} {t("из")} {entries.length}</span>
            <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)} aria-label={t("Назад")} className="px-[5px]">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${current <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
            </button>
            <button type="button" disabled={current >= pageCount} onClick={() => onPage(current + 1)} aria-label={t("Вперед")}>
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${current >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
            </button>
          </div>
        </>
      )}
    </DialogFrame>
  );
}

/** «Добавить балл» (Linko's 300px dialog): Плюсовой / Минусовой балл (Минусовой by default), Акция*, Балл*, Оставить
 * комментарий...*, «Добавить». */
function AddBallDialog({ client, promotions, onClose, onSaved }: { client: BonusRow; promotions: KitOption[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [kind, setKind] = useState<"plus" | "minus">("minus");
  const [promotion, setPromotion] = useState("");
  const [ball, setBall] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const amount = strictNumber(ball, { locale: true });
    const next: Record<string, string> = {};
    if (!promotion) next.promotion = "Обязательное поле";
    if (!ball.trim()) next.ball = "Обязательное поле";
    else if (!Number.isFinite(amount) || amount <= 0) next.ball = "Введите число больше нуля";
    if (!comment.trim()) next.comment = "Обязательное поле";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const response = await fetch("/api/client-bonuses/custom-ball", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client.id, promotion: Number(promotion), ball: kind === "plus" ? amount : -amount, comment: comment.trim() }),
      });
      if (response.ok) {
        onSaved();
        return;
      }
      const { error, field } = await refusal(response);
      if (field === "promotion" || field === "ball" || field === "comment") setErrors({ [field]: error });
      else notify(t(error));
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame width={300} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="relative flex items-center justify-between border-b border-[#efefef] px-[30px] py-[20px]">
          <b className="font-bold uppercase">{t("Добавить балл")}</b>
          <span className="absolute right-[13px]">
            <CloseButton onClick={onClose} />
          </span>
        </div>
        <div className="mb-[20px] min-h-[250px] p-[20px]">
          <div className="flex flex-col gap-[10px]">
            {(["plus", "minus"] as const).map((value) => (
              <label key={value} className="flex h-6 cursor-pointer items-center gap-4 text-[13px]">
                <input type="radio" name="bonusType" checked={kind === value} onChange={() => setKind(value)} className="h-[22px] w-[22px] accent-[#5d6474]" />
                {t(value === "plus" ? "Плюсовой балл" : "Минусовой балл")}
              </label>
            ))}
          </div>
          <div className="mt-[29px] flow-root">
            <KitSearchSelect label="Акция" required options={promotions} value={promotion} onChange={setPromotion} error={errors.promotion} />
          </div>
          <FloatingField label="Балл" value={ball} error={errors.ball} onChange={(value) => setBall(value.replace(/[^\d.,\s]/g, ""))} inputMode="decimal" />
          <div className="mt-[9px]">
            <FloatingField label={`${t("Оставить комментарий")}...`} value={comment} error={errors.comment} onChange={setComment} multiline />
          </div>
        </div>
        <div className="border-t border-[#efefef] p-[10px] text-right">
          <button type="submit" disabled={saving} className="h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50">
            {t("Добавить")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

/** «Импорт» (Linko's import dialog): Акция*, «1. Скачать шаблон» (every listed client: № · Наименование магазина ·
 * Балл(*) · Комментарий), the file, «Сохранить»: the rows with a Балл are scored under the promotion, all or nothing. */
function ImportDialog({ promotions, templateRows, onClose, onSaved }: { promotions: KitOption[]; templateRows: BonusRow[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [promotion, setPromotion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [promotionError, setPromotionError] = useState("");
  const [saving, setSaving] = useState(false);

  function template() {
    downloadExcelTable("BallUpdate", [[t("№"), t("Наименование магазина"), t("Балл(*)"), t("Комментарий")], [null, null, null, null], ...templateRows.map((row) => [row.id, row.name, null, null])], { blankNulls: true });
  }

  async function save() {
    if (saving || !file) return;
    if (!promotion) {
      setPromotionError("Обязательное поле");
      return;
    }
    setPromotionError("");
    setSaving(true);
    setError("");
    try {
      const sheet = await readExcelRows(file);
      const lines: { client: number; ball: number; comment: string }[] = [];
      const bad: number[] = [];
      sheet.forEach((cells, index) => {
        const id = (cells[0] ?? "").trim();
        if (!/^\d+$/.test(id)) return;
        const text = (cells[2] ?? "").trim();
        if (!text) return;
        const ball = strictNumber(text, { locale: true });
        if (!Number.isFinite(ball)) {
          bad.push(index + 1);
          return;
        }
        if (ball !== 0) lines.push({ client: Number(id), ball, comment: (cells[3] ?? "").trim() });
      });
      if (bad.length) {
        setError(`${t("Должно быть числом")}: ${t("строка")} ${bad.slice(0, 10).join(", ")}`);
        return;
      }
      if (!lines.length) {
        setError(t("В файле нет строк с баллом"));
        return;
      }
      const response = await fetch("/api/client-bonuses/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promotion: Number(promotion), rows: lines }),
      });
      if (response.ok) {
        onSaved();
        return;
      }
      const { error: message, field } = await refusal(response);
      const row = field?.match(/^rows\.(\d+)$/);
      if (field === "promotion") setPromotionError(message);
      else if (row && lines[Number(row[1])]) setError(`${t(message)}: № ${lines[Number(row[1])].client}`);
      else setError(t(message));
    } catch {
      setError(t("Не удалось прочитать файл"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RefImportDialog
      title={t("Импорт")}
      file={file}
      onFile={(picked) => {
        setFile(picked);
        setError("");
      }}
      onTemplate={template}
      onSave={() => void save()}
      onClose={onClose}
      saving={saving}
      error={error || undefined}
      top={
        <div className="mb-[15px] min-h-[52px]">
          <KitSearchSelect label="Акция" required options={promotions} value={promotion} onChange={(value) => {
            setPromotion(value);
            setPromotionError("");
          }} error={promotionError || undefined} />
        </div>
      }
    />
  );
}

/** Linko's material text field of a dialog (45px, 7px above): the label sits on the line while it is empty and floats up
 * (10px) once focused or filled; a required red "*"; the reason under the line. `multiline` grows with the text. */
function FloatingField({ label, value, onChange, error, multiline, inputMode }: { label: string; value: string; onChange: (value: string) => void; error?: string; multiline?: boolean; inputMode?: "decimal" }) {
  const { t } = useLanguage();
  const [focused, setFocused] = useState(false);
  const up = focused || value !== "";
  const common = {
    value,
    "aria-label": t(label),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    className: "w-full resize-none bg-transparent text-[13px] leading-[20px] text-black outline-none",
  };
  return (
    <label className="block">
      <span className={`relative mt-[7px] flex min-h-[45px] items-end border-b pb-[4px] ${error ? "border-[#f44336]" : focused ? "border-[#555]" : "border-[#e0e0e0]"}`}>
        <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${up ? "top-[3px] text-[10px] leading-[13px]" : "top-[19px] text-[13px] leading-[20px]"}`}>
          {t(label)}
          <span className="text-[#f44336]"> *</span>
        </span>
        {multiline ? (
          <textarea
            {...common}
            rows={1}
            onChange={(event) => {
              onChange(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
            }}
          />
        ) : (
          <input {...common} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
        )}
      </span>
      {error && <span className="mt-[3px] block text-[12px] leading-[14px] text-[#f44336]">{t(error)}</span>}
    </label>
  );
}
