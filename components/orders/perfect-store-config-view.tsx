"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { KitSearchSelect, type KitOption } from "@/components/orders/field-filter-kit";
import { FilterCheck, RI, RefButton, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit";
import { askDelete } from "@/lib/ask-confirm";
import { useLanguage } from "@/lib/i18n/language-context";
import { notify } from "@/lib/notify";

// "Perfect Store Config" (Perfect store → Конфигурация), the reference's #/perfect-store-config: the list (search,
// page size, «1 - 25 из N» with ‹ ›; № / Наименование / Активный «Да»/«Нет», ✎ and 🗑 on the hovered row) and the
// full-screen «Добавить Config» / «Изменить Config» form: Наименование *, Организация *, Активный on the left; on the
// right a questionnaire (Опросник) and «Опросник основной зоны» added with ✓ to the list under them (Наименование,
// Да / Нет, 🗑). The configs are kept on the server (GET/POST/PUT/DELETE /api/surveys/perfect-store-configs,
// lib/perfect-store-configs-repo.ts). The link carries the reference's state: pageSize / page / search, openCreateDialog,
// and the edited config as /analytics/perfect-store/config/<id>?openUpdateDialog=true.

type ConfigItem = { quizId: number; quizName: string; isStoreQuiz: boolean };
type Config = { id: number; name: string; organizationId: number | null; organization: string; isActive: boolean; items: ConfigItem[] };
type Draft = { name: string; organizationId: string; isActive: boolean; items: ConfigItem[]; quiz: string; isStoreQuiz: boolean };
type Errors = Partial<Record<"name" | "organizationId" | "items", string>>;

const API = "/api/surveys/perfect-store-configs";
const LIST_PATH = "/analytics/perfect-store/config";
const EMPTY_DRAFT: Draft = { name: "", organizationId: "", isActive: false, items: [], quiz: "", isStoreQuiz: false };
const NAME_ORDER = new Intl.Collator("en", { ignorePunctuation: true });
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";

type UrlState = { page: number; pageSize: number; search: string; create: boolean; update: boolean };

function readUrl(search: string): UrlState {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  const size = Number(params.get("pageSize"));
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 25, 50, 100].includes(size) ? size : 25,
    search: (params.get("search") ?? "").trim(),
    create: params.get("openCreateDialog") === "true",
    update: params.get("openUpdateDialog") === "true",
  };
}

function urlOf(path: string, state: UrlState): string {
  const params = new URLSearchParams();
  if (state.page > 1) params.set("page", String(state.page));
  params.set("pageSize", String(state.pageSize));
  if (state.search) params.set("search", state.search);
  if (state.create) params.set("openCreateDialog", "true");
  if (state.update) params.set("openUpdateDialog", "true");
  return `${path}?${params.toString()}`;
}

/** The server's refusal: its message, its field, and every refused field's first message (a form shows them all at once,
 * as the reference prints «Обязательное поле» under each empty required field). */
async function readError(response: Response | null): Promise<{ error: string; field: string | null; fields: Record<string, string> }> {
  if (!response) return { error: "Сервер недоступен, попробуйте ещё раз", field: null, fields: {} };
  const body = (await response.json().catch(() => null)) as { error?: unknown; field?: unknown; details?: { fieldErrors?: Record<string, unknown> } } | null;
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(body?.details?.fieldErrors ?? {})) {
    if (Array.isArray(messages) && typeof messages[0] === "string") fields[key] = messages[0];
  }
  return { error: typeof body?.error === "string" && body.error ? body.error : "Не удалось сохранить", field: typeof body?.field === "string" ? body.field : null, fields };
}

/** The reference's 400-weight MUI text field with the label above, a red "*" when required and the error under it. */
function NameField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const { t } = useLanguage();
  const [focused, setFocused] = useState(false);
  const floating = focused || value !== "";
  return (
    <div className="relative min-h-[52px]">
      <div className={`relative mt-[7px] h-[45px] border-b ${error ? "border-[#f44336]" : focused ? "border-[#1E4A9A]" : "border-[#e0e0e0]"}`}>
        <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${floating ? "top-[3px] text-[10px] leading-[13px]" : "top-[22px] text-[13px] leading-[18px]"}`}>
          {t("Наименование")}
          <span className="text-[#f44336]"> *</span>
        </span>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={t("Наименование")}
          className="absolute inset-x-0 bottom-[4px] h-[20px] bg-transparent text-[13px] text-black outline-none"
        />
      </div>
      {error && <div className="mt-[3px] text-[12px] leading-[14px] text-[#f44336]">{t(error)}</div>}
    </div>
  );
}

function ConfigDialog({
  title,
  action,
  initial,
  organizations,
  quizzes,
  onClose,
  onSubmit,
}: {
  title: string;
  action: string;
  initial: Draft;
  organizations: KitOption[];
  quizzes: KitOption[];
  onClose: () => void;
  onSubmit: (draft: Draft) => Promise<Errors | null>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** ✓: the chosen questionnaire goes on top of the list (once), and the row's fields are cleared. */
  function addQuiz() {
    const quizId = Number(draft.quiz);
    if (!quizId) return;
    const quizName = quizzes.find((option) => option.value === draft.quiz)?.label ?? `#${quizId}`;
    setDraft((current) => ({ ...current, items: [{ quizId, quizName, isStoreQuiz: current.isStoreQuiz }, ...current.items.filter((item) => item.quizId !== quizId)], quiz: "", isStoreQuiz: false }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const refused = await onSubmit(draft);
    setSaving(false);
    if (refused) setErrors(refused);
  }

  return (
    <div className="fixed inset-0 z-[1500] overflow-y-auto bg-black/[0.54]" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={submit} className="relative min-h-full bg-white font-sans text-[13px] text-[#333]">
        <div className="flex h-[88px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px]">
          <span className="text-[13px] font-bold uppercase">{title}</span>
          <div className="flex items-center gap-[20px]">
            <button type="submit" disabled={saving} className="h-[36px] min-w-[88px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-60">{action}</button>
            <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={CLOSE} /></svg>
            </button>
          </div>
        </div>
        <div className="flex min-h-[calc(100vh-88px)] flex-col md:flex-row">
          <div className="w-full px-[30px] pt-[12px] md:w-[30%]">
            <NameField value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} error={errors.name} />
            <div className="mt-[14px]">
              <KitSearchSelect label="Организация" required options={organizations} value={draft.organizationId} onChange={(organizationId) => setDraft((current) => ({ ...current, organizationId }))} error={errors.organizationId} />
            </div>
            <div className="mt-[14px]">
              <FilterCheck label="Активный" compact checked={draft.isActive} onChange={(isActive) => setDraft((current) => ({ ...current, isActive }))} />
            </div>
          </div>
          <div className="w-full border-l border-[#efefef] md:w-[70%]">
            <div className="grid grid-cols-12 items-end bg-[#f1f5f8] pb-[10px] pl-[30px] pr-[40px]">
              <div className="col-span-4 pt-[10px]">
                <KitSearchSelect label="Опросник" options={quizzes} value={draft.quiz} onChange={(quiz) => setDraft((current) => ({ ...current, quiz }))} />
              </div>
              <div className="col-span-2" />
              <div className="col-span-4 pb-[11px]">
                <FilterCheck label="Опросник основной зоны" compact checked={draft.isStoreQuiz} onChange={(isStoreQuiz) => setDraft((current) => ({ ...current, isStoreQuiz }))} />
              </div>
              <div className="col-span-2 flex justify-end pb-[2px]">
                <button type="button" onClick={addQuiz} aria-label={t("Добавить")} title={t("Добавить")} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden><path d={CHECK} /></svg>
                </button>
              </div>
            </div>
            {errors.items && <div className="px-[30px] pt-[8px] text-[12px] text-[#f44336]">{t(errors.items)}</div>}
            {draft.items.length > 0 && (
              <div className="px-[30px]">
                <div className="grid grid-cols-12 items-center border-b border-dashed border-[#d9e0e5] py-[12px] font-semibold">
                  <span className="col-span-6">{t("Наименование")}</span>
                  <span className="col-span-4">{t("Активный")}</span>
                  <span className="col-span-2" />
                </div>
                {draft.items.map((item, index) => (
                  <div key={`${item.quizId}-${index}`} className="grid grid-cols-12 items-center border-b border-dashed border-[#d9e0e5]">
                    <span className="col-span-6">{item.quizName}</span>
                    <span className="col-span-4">{item.isStoreQuiz ? t("Да") : t("Нет")}</span>
                    <span className="col-span-2 flex justify-end">
                      <button type="button" aria-label={t("Удалить")} title={t("Удалить")} onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }))} className="flex h-12 w-12 items-center justify-center">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={RI.trash} /></svg>
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export function PerfectStoreConfigView({ itemId }: { itemId?: number }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [url, setUrl] = useState<UrlState | null>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Config[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<Config | null>(null);
  const [organizations, setOrganizations] = useState<KitOption[]>([]);
  const [quizzes, setQuizzes] = useState<KitOption[]>([]);
  const [notice, setNotice] = useState("");
  const path = itemId ? `${LIST_PATH}/${itemId}` : LIST_PATH;

  useEffect(() => {
    const sync = () => {
      const next = readUrl(window.location.search);
      setUrl(next);
      setQuery(next.search);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const go = useCallback((next: UrlState, nextPath = path, replace = false) => {
    setUrl(next);
    const target = urlOf(nextPath, next);
    if (nextPath !== path) router.push(target);
    else if (replace) window.history.replaceState(window.history.state, "", target);
    else window.history.pushState(window.history.state, "", target);
  }, [path, router]);

  // The link always carries pageSize (the reference's list wrapper writes it).
  useEffect(() => {
    if (!url) return;
    const target = urlOf(path, url);
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.replaceState(window.history.state, "", target);
  }, [url, path]);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(url.page), pageSize: String(url.pageSize) });
    if (url.search) params.set("search", url.search);
    setLoading(true);
    fetch(`${API}?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { count?: number; rows?: Config[]; error?: string } | null;
        if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error || "Не удалось загрузить данные");
        setRows(body.rows);
        setCount(Number(body.count) || 0);
        setLoading(false);
      })
      .catch((cause: Error) => {
        if (cause.name === "AbortError") return;
        setRows([]);
        setCount(0);
        setLoading(false);
        notify(t(cause.message || "Не удалось загрузить данные"));
      });
    return () => controller.abort();
    // `t` only translates the error text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url?.page, url?.pageSize, url?.search, reload]);

  // The form's lists: the organizations by name; the active questionnaires by their order number (empty last), the newest
  // first among equal numbers — the reference's questionnaire select.
  useEffect(() => {
    let cancelled = false;
    const load = (source: string) => fetch(source, { cache: "no-store" }).then((response) => (response.ok ? response.json() : [])).catch(() => []);
    void Promise.all([load("/api/organizations"), load("/api/surveys")]).then(([orgs, surveys]: [unknown, unknown]) => {
      if (cancelled) return;
      const list = (rows: unknown) => (Array.isArray(rows) ? (rows as Array<{ id?: unknown; name?: unknown }>) : []).filter((row) => Number(row.id) > 0 && String(row.name ?? "").trim());
      setOrganizations(list(orgs).map((row) => ({ value: String(row.id), label: String(row.name).trim() })).sort((a, b) => NAME_ORDER.compare(a.label, b.label)));
      const order = (row: { orderNo?: unknown }) => {
        const text = String(row.orderNo ?? "").trim();
        return /^\d+$/.test(text) ? Number(text) : Number.POSITIVE_INFINITY;
      };
      setQuizzes(
        (list(surveys) as Array<{ id?: unknown; name?: unknown; active?: unknown; orderNo?: unknown }>)
          .filter((row) => row.active !== false)
          .sort((a, b) => order(a) - order(b) || Number(b.id) - Number(a.id))
          .map((row) => ({ value: String(row.id), label: String(row.name).trim() })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The edited config (/config/<id>?openUpdateDialog=true).
  useEffect(() => {
    if (!itemId || !url?.update) return;
    let cancelled = false;
    fetch(`${API}/${itemId}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as Config | { error?: string } | null;
        if (!response.ok || !body || !("id" in body)) throw new Error((body as { error?: string } | null)?.error || "Не найдено");
        if (!cancelled) setDetail(body);
      })
      .catch((cause: Error) => !cancelled && notify(t(cause.message)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, url?.update]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);
  const closeCreate = useCallback(() => urlRef.current && go({ ...urlRef.current, create: false }), [go]);
  const closeUpdate = useCallback(() => {
    if (!urlRef.current) return;
    setDetail(null);
    go({ ...urlRef.current, update: false }, LIST_PATH);
  }, [go]);

  const updateInitial = useMemo<Draft | null>(
    () => (detail ? { ...EMPTY_DRAFT, name: detail.name, organizationId: detail.organizationId ? String(detail.organizationId) : "", isActive: detail.isActive, items: detail.items } : null),
    [detail],
  );

  if (!url) return <RefPage><RefHeader title="Perfect Store Config" /></RefPage>;
  const current = url;
  const pageCount = Math.max(1, Math.ceil(count / current.pageSize));
  const from = count === 0 ? 0 : (current.page - 1) * current.pageSize + 1;
  const to = Math.min(current.page * current.pageSize, count);

  /** POST / PUT of the form; the field the server refused (Обязательное поле, …) comes back to the form. */
  async function save(draft: Draft, id?: number): Promise<Errors | null> {
    const body = {
      name: draft.name,
      organizationId: draft.organizationId ? Number(draft.organizationId) : null,
      isActive: draft.isActive,
      items: draft.items.map((item) => ({ quizId: item.quizId, isStoreQuiz: item.isStoreQuiz })),
    };
    const response = await fetch(id ? `${API}/${id}` : API, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!response?.ok) {
      const { error, field, fields } = await readError(response);
      const refused: Errors = {};
      for (const key of ["name", "organizationId", "items"] as const) if (fields[key]) refused[key] = fields[key];
      const key = field?.split(".")[0];
      if ((key === "name" || key === "organizationId" || key === "items") && !refused[key]) refused[key] = error;
      if (Object.keys(refused).length) return refused;
      notify(t(error));
      return {};
    }
    setNotice(t("Успешно сохранено"));
    setReload((value) => value + 1);
    return null;
  }

  async function remove(config: Config) {
    if (!(await askDelete(config.name))) return;
    const response = await fetch(`${API}/${config.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      notify(t("Удаление невозможно из-за связи с другими данными"));
      return;
    }
    setNotice(t("Успешно удалено"));
    setReload((value) => value + 1);
  }

  return (
    <RefPage>
      <RefHeader title="Perfect Store Config">
        <RefButton green icon={RI.add} label={`${t("Добавить")} Config`} onClick={() => go({ ...current, create: true })} />
      </RefHeader>
      <section className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <RefToolbar
            hideFilter
            query={query}
            onQuery={(value) => {
              setQuery(value);
              go({ ...current, search: value.trim(), page: 1 }, path, true);
            }}
            pageSize={current.pageSize}
            onPageSize={(pageSize) => go({ ...current, pageSize, page: 1 })}
            from={from}
            to={to}
            total={count}
            page={current.page}
            pageCount={pageCount}
            onPage={(page) => go({ ...current, page })}
          />
        </form>
        <RefTable
          cols="minmax(0,2fr) minmax(0,5fr) minmax(0,4fr) minmax(0,1fr)"
          heads={["№", "Наименование", "Активный", ""]}
          rows={loading ? [] : rows}
          rowKey={(row) => row.id}
          minWidth={0}
          empty={loading ? <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#1E4A9A] border-t-transparent" /> : t("По вашему запросу ничего не найдено")}
          render={(row) => [
            row.id,
            row.name,
            row.isActive ? t("Да") : t("Нет"),
            <div key="actions" className="flex items-center justify-end gap-[10px] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <button type="button" title={t("Изменить")} aria-label={t("Изменить")} onClick={() => go({ ...current, update: true }, `${LIST_PATH}/${row.id}`)} className="flex h-[25px] w-[30px] items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden><path d={RI.edit} /></svg>
              </button>
              <button type="button" title={t("Удалить")} aria-label={t("Удалить")} onClick={() => void remove(row)} className="flex h-[25px] w-[30px] items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden><path d={RI.trash} /></svg>
              </button>
            </div>,
          ]}
        />
      </section>
      {current.create && (
        <ConfigDialog
          title={`${t("Добавить")} Config`}
          action={t("Добавить")}
          initial={EMPTY_DRAFT}
          organizations={organizations}
          quizzes={quizzes}
          onClose={closeCreate}
          onSubmit={async (draft) => {
            const refused = await save(draft);
            if (!refused) closeCreate();
            return refused;
          }}
        />
      )}
      {current.update && itemId && updateInitial && detail?.id === itemId && (
        <ConfigDialog
          key={detail.id}
          title={`${t("Изменить")} Config`}
          action={t("Изменить")}
          initial={updateInitial}
          organizations={organizations}
          quizzes={quizzes}
          onClose={closeUpdate}
          onSubmit={async (draft) => {
            const refused = await save(draft, itemId);
            if (!refused) closeUpdate();
            return refused;
          }}
        />
      )}
      {notice && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[1600] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-[14px] text-[14px] text-white shadow-lg">
          {notice}
        </div>
      )}
    </RefPage>
  );
}
