"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { ClientDrawer } from "@/components/clients/clients-view";
import { useCanManage } from "@/components/analytics/cash-management-shared";
import { KitMultiSelect, KitRangeField, type KitOption } from "@/components/orders/field-filter-kit";
import { RefHeader, RefPage } from "@/components/ref/list-kit";
import { csvText } from "@/lib/csv";
import { todayIso } from "@/lib/finance/dates";
import { useLanguage } from "@/lib/i18n/language-context";

// "Perfect store" (Продажи), the reference's #/perfect-store: tabs Не подтверждён / Подтверждён / Все (is_approved in
// the link), the filter row (Дата создания as a period, Создал / Тип клиента / Филиалы as multi selects, «Применить»),
// the totals (the blue Присутствие / Доля на полке values open their dialogs, openTotalAvailabilityDialog /
// openShelfShareTotal in the link) and the visit table. Mezon has no perfect store visits yet (the mobile app sends
// none): the totals and the table stay empty whatever the filter, and the dialogs show their empty tables, as the
// reference's do for an account without visits. openShop=<client id> opens the shared shop drawer over the page (the
// reference's shopDetails: only its X closes it).
//
// The link is the page's state, written the way the reference's router writes it (keys in alphabetical order, a key
// set to null printed bare): a tab, a dialog or the drawer's X changes its own key and keeps every other one
// (filter.getParams), each as a history entry; «Применить» rebuilds the link from the filter (filterBy: page=1, the
// page size, openFilterDialog=false, the filter values, status and is_approved), so the open drawer and its tab
// parameters go. Only the menu's bare link is rewritten, with the reference's defaults (today, 25 per page).

const TABS = [
  ["Не подтверждён", "false"],
  ["Подтверждён", "true"],
  ["Все", "all"],
] as const;
/** "" = no is_approved in the link (the menu's): every visit, like "all". */
type Approved = (typeof TABS)[number][1] | "";

type PageState = {
  fromDate: string;
  toDate: string;
  createdBy: number[];
  marketTypeParent: number[];
  branch: number[];
  approved: Approved;
  pageSize: number;
  availability: boolean;
  shelfShare: boolean;
  /** The client whose shop drawer is open (0: none). */
  openShop: number;
};
type FilterValues = Pick<PageState, "fromDate" | "toDate" | "createdBy" | "marketTypeParent" | "branch">;

const STATE_KEYS = new Set(["fromDate", "toDate", "createdBy", "marketTypeParent", "marketType", "branch", "status", "is_approved", "page", "pageSize", "openFilterDialog", "openTotalAvailabilityDialog", "openShelfShareTotal", "openShop"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const idList = (value: string | null) => [...new Set((value ?? "").split("-").map((part) => Number(part.trim())).filter((id) => Number.isSafeInteger(id) && id > 0))];

/** The menu's bare link (none of the page's keys): the reference's defaults are written into it. */
const isBare = (params: URLSearchParams) => ![...params.keys()].some((key) => STATE_KEYS.has(key));

/** The link → the state. The menu's bare link is the reference's: today, 25 per page, every visit. */
function readState(search: string): PageState {
  const params = new URLSearchParams(search);
  const bare = isBare(params);
  const today = todayIso();
  const fromDate = bare ? today : ISO_DAY.test(params.get("fromDate") ?? "") ? (params.get("fromDate") as string) : "";
  const toParam = params.get("toDate") ?? "";
  const approved = params.get("is_approved");
  const size = Number(params.get("pageSize"));
  const shop = Number(params.get("openShop"));
  return {
    fromDate,
    toDate: !fromDate ? "" : bare ? today : ISO_DAY.test(toParam) ? toParam : fromDate,
    createdBy: idList(params.get("createdBy")),
    marketTypeParent: idList(params.get("marketTypeParent")),
    branch: idList(params.get("branch")),
    approved: approved === "false" || approved === "true" || approved === "all" ? approved : "",
    pageSize: Number.isSafeInteger(size) && size > 0 ? size : 25,
    availability: params.get("openTotalAvailabilityDialog") === "true",
    shelfShare: params.get("openShelfShareTotal") === "true",
    openShop: Number.isSafeInteger(shop) && shop > 0 ? shop : 0,
  };
}

/** The reference's query string: keys in alphabetical order, an empty value (a key set to null there) printed bare. */
function linkSearch(params: URLSearchParams): string {
  return [...new Set(params.keys())]
    .sort()
    .flatMap((key) => params.getAll(key).map((value) => (value === "" ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)))
    .join("&");
}

/** Puts `params` into the address (a new history entry, or in place). */
function writeLink(params: URLSearchParams, mode: "push" | "replace") {
  const search = linkSearch(params);
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (mode === "push") window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

/** The link the filter's «Применить» writes (the reference's filterBy: the query is rebuilt, empty values left out). */
function filterParams(values: FilterValues, current: PageState, link: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams({ openFilterDialog: "false", page: "1", pageSize: String(current.pageSize) });
  const set = (key: string, value: string | null) => {
    if (value) params.set(key, value);
  };
  set("createdBy", values.createdBy.join("-"));
  set("marketTypeParent", values.marketTypeParent.join("-"));
  set("branch", values.branch.join("-"));
  set("fromDate", values.fromDate);
  set("toDate", values.fromDate ? values.toDate || values.fromDate : "");
  set("status", link.get("status"));
  set("is_approved", link.get("is_approved"));
  return params;
}

// The reference's selects: users by id (active only), top-level client types and branches by name in its database's
// order (letters before Cyrillic, case and punctuation ignored at first).
const NAME_ORDER = new Intl.Collator("en", { ignorePunctuation: true });
type Named = { id: number; name: string };
const byName = (list: Named[]) => [...list].sort((a, b) => NAME_ORDER.compare(a.name, b.name) || a.id - b.id);
const options = (list: Named[]): KitOption[] => list.map((item) => ({ value: String(item.id), label: item.name }));
const ids = (values: string[]) => values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);

async function loadList(url: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json().catch(() => null)) as unknown;
  return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
}

/** A row of a directory as an option; a user without a name still is one ("#id"), as on the photo report filter. */
const named = (row: Record<string, unknown>, name: unknown, keepNameless = false): Named | null => {
  const id = Number(row.id);
  const text = String(name ?? "").trim();
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return text ? { id, name: text } : keepNameless ? { id, name: `#${id}` } : null;
};

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

/** The reference's Material-UI dialog of the totals: 64 px from the top, a 60 px title bar (bold uppercase, ✕). As
 * there, only the ✕ closes it (not Escape, not a click beside it). */
function TotalsDialog({ title, width, onClose, children }: { title: string; width: number; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-[1500] overflow-y-auto bg-black/[0.54] px-4 pb-[64px] pt-[64px] font-sans text-[13px] text-[#333]">
      <div role="dialog" aria-modal="true" aria-label={title} style={{ width }} className="mx-auto max-w-full bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] p-[12px] font-bold uppercase">
          <span>{title}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
              <path d={CLOSE} />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** «Присутствие в торговой точке»: segments → product groups → products with their store counts and percents. */
function AvailabilityDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const head = "border border-[#e0e0e0] px-[8px] py-[6px] text-center text-[14px] font-bold leading-[18px]";
  return (
    <TotalsDialog title={t("Присутствие в торговой точке")} width={1000} onClose={onClose}>
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className={`${head} w-[50px]`} />
            <th className={head}>{t("Сегментация")}</th>
            <th className={`${head} w-[378px]`}>{t("Наименование продукта")}</th>
            <th className={head}>{t("Кол-во ТТ с присутствием")}</th>
            <th className={head}>{t("Присутствие по товару")}</th>
            <th className={head}>{t("Присутствие по группе")}</th>
            <th className={head}>{t("Присутствие по бренду")}</th>
          </tr>
        </thead>
        {/* No perfect store visit: no segment rows. */}
        <tbody />
      </table>
    </TotalsDialog>
  );
}

/** «Доля на полке»: the Наш / Конкуренты donut and the per-segment donut ("Итого" in the middle), and their table. */
function ShelfShareDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  // The reference prints the total of an empty chart as the browser's NaN ("не число").
  const empty = Number.NaN.toLocaleString("ru");
  const head = "min-w-[50px] border border-[#ccc] p-[8px] text-center font-bold";
  return (
    <TotalsDialog title={t("Доля на полке")} width={768} onClose={onClose}>
      <div className="mb-[10px] grid grid-cols-2 gap-[20px] px-[10px]">
        {[0, 1].map((index) => (
          <div key={index} className="mt-[10px] flex h-[350px] flex-col items-center justify-center rounded-[10px] bg-white text-center shadow-[0_8px_24px_rgba(149,157,165,0.2)]">
            <span className="text-[13px] font-bold leading-[14px] text-[#333]">{empty}</span>
            <span className="text-[12px] lowercase leading-[13px] text-[#555]">{t("Итого")}</span>
          </div>
        ))}
      </div>
      <table className="w-full border-collapse text-[14px] shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
        <thead>
          <tr>
            <th className={head} />
            <th className={head}>{t("Сегмент")}</th>
            <th className={head}>Face</th>
            <th className={head}>{t("Доля")} %</th>
            <th className={head} />
          </tr>
        </thead>
        <tbody />
      </table>
    </TotalsDialog>
  );
}

export function PerfectStoreView() {
  const { t } = useLanguage();
  const [state, setState] = useState<PageState | null>(null);
  const [draft, setDraft] = useState<FilterValues | null>(null);
  const [users, setUsers] = useState<Named[]>([]);
  const [clientTypes, setClientTypes] = useState<Named[]>([]);
  const [branches, setBranches] = useState<Named[]>([]);

  // Link → state on mount and on Back / Forward; only the menu's bare link is rewritten (the reference's defaults).
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const next = readState(window.location.search);
      setState(next);
      setDraft(null);
      if (isBare(params)) {
        params.set("fromDate", next.fromDate);
        params.set("toDate", next.toDate);
        params.set("pageSize", String(next.pageSize));
        writeLink(params, "replace");
      }
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadList("/api/employees"), loadList("/api/client-types"), loadList("/api/branches")]).then(([employees, types, branchRows]) => {
      if (cancelled) return;
      setUsers(
        employees
          .filter((row) => row.active !== false)
          .map((row) => named(row, row.name ?? `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`, true))
          .filter((row): row is Named => row !== null)
          .sort((a, b) => a.id - b.id),
      );
      setClientTypes(byName(types.filter((row) => row.parentId === null || row.parentId === undefined).map((row) => named(row, row.name)).filter((row): row is Named => row !== null)));
      setBranches(byName(branchRows.map((row) => named(row, row.name)).filter((row): row is Named => row !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Changes keys of the link and keeps the others (null: the key printed bare, as the reference's null). */
  const navigate = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) params.set(key, value ?? "");
    writeLink(params, "push");
    setState(readState(window.location.search));
  }, []);

  // The reference's X of the totals dialogs writes 0, the drawer's X a bare openShop.
  const closeAvailability = useCallback(() => navigate({ openTotalAvailabilityDialog: "0" }), [navigate]);
  const closeShelfShare = useCallback(() => navigate({ openShelfShareTotal: "0" }), [navigate]);
  const closeShop = useCallback(() => navigate({ openShop: null }), [navigate]);
  // A client that cannot be loaded (deleted, a wrong id): no drawer, and the link stays as it is, so Back still leaves.
  const keepMissingShop = useCallback(() => {}, []);
  // The drawer's pencil opens the Клиенты edit form only for those who may change clients (as on the other pages).
  const canEditShop = useCanManage(["clients.manage"]);

  if (!state) return <RefPage><RefHeader title="Perfect store" /></RefPage>;
  const current = state;
  const values: FilterValues = draft ?? { fromDate: current.fromDate, toDate: current.toDate, createdBy: current.createdBy, marketTypeParent: current.marketTypeParent, branch: current.branch };
  const setValue = <K extends keyof FilterValues>(key: K, value: FilterValues[K]) => setDraft({ ...values, [key]: value });
  const tabLabel = TABS.find(([, code]) => code === (current.approved || "all"))?.[0] ?? "Все";

  const download = () => {
    const csv = csvText([["ID", "Создал", "Агент", "Магазин", "Дата создания", "Присутствие", "Доля", "Задача", "Комментарий", "Статус задачи"].map((head) => t(head))]) + "\n";
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
        <Link href="/analytics/perfect-store/config?pageSize=25" className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Конфигурация")}</Link>
      </RefHeader>

      <section className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[52px] border-b border-[#e5e8ed]">
          {TABS.map(([label, code]) => (
            <button key={label} type="button" onClick={() => code !== (current.approved || "all") && navigate({ is_approved: code })} className="relative h-full flex-1 text-[13px] font-medium text-[#333]">
              {t(label)}
              {tabLabel === label && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#1E4A9A]" />}
            </button>
          ))}
        </div>
        <form
          className="px-[10px] pb-[10px] pt-[19px]"
          onSubmit={(event) => {
            event.preventDefault();
            setDraft(null);
            writeLink(filterParams(values, current, new URLSearchParams(window.location.search)), "push");
            setState(readState(window.location.search));
          }}
        >
          {/* The reference's row: «Дата создания» and three selects, four equal columns 10 px apart. */}
          <div className="grid grid-cols-4 gap-x-[10px] px-[10px]">
            <KitRangeField label="Дата создания" begin={values.fromDate} end={values.toDate} onChange={(begin, end) => setDraft({ ...values, fromDate: begin, toDate: end })} />
            <KitMultiSelect label="Создал" options={options(users)} value={values.createdBy.map(String)} onChange={(next) => setValue("createdBy", ids(next))} />
            <KitMultiSelect label="Тип клиента" options={options(clientTypes)} value={values.marketTypeParent.map(String)} onChange={(next) => setValue("marketTypeParent", ids(next))} />
            <KitMultiSelect label="Филиалы" options={options(branches)} value={values.branch.map(String)} onChange={(next) => setValue("branch", ids(next))} />
          </div>
          {/* No perfect store visits in Mezon: the applied filter only goes into the link, the list stays empty. */}
          <button type="submit" className="mt-[17px] h-[36px] w-full rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">{t("Применить")}</button>
        </form>
      </section>

      <section className="mt-[34px] grid grid-cols-3 gap-[16px] text-[13px]">
        <div className="h-[114px] bg-white px-[16px] pt-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.1)]"><p className="leading-[18px] text-[#5d6474]">{t("Кол-во магазинов")}</p><b className="mt-[4px] block text-[14px] font-semibold leading-[18px]">0</b><p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Кол-во perfect strore")}</p><b className="mt-[4px] block text-[14px] font-semibold leading-[18px]">0</b></div>
        <div className="h-[114px] bg-white px-[16px] pt-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.1)]">
          <p className="leading-[18px] text-[#5d6474]">{t("Присутствие")}</p>
          <b className="mt-[4px] block text-[14px] font-semibold leading-[18px]"><span role="button" tabIndex={0} onClick={() => navigate({ openTotalAvailabilityDialog: "true" })} onKeyDown={(event) => event.key === "Enter" && navigate({ openTotalAvailabilityDialog: "true" })} className="cursor-pointer text-[#0000ff]">0 %</span></b>
          <p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Доля на полке")}</p>
          <b className="mt-[4px] block text-[14px] font-semibold leading-[18px]"><span role="button" tabIndex={0} onClick={() => navigate({ openShelfShareTotal: "true" })} onKeyDown={(event) => event.key === "Enter" && navigate({ openShelfShareTotal: "true" })} className="cursor-pointer text-[#0000ff]">0 %</span></b>
        </div>
        <div className="h-[114px] bg-white px-[16px] pt-[10px] text-right shadow-[0_1px_4px_rgba(0,0,0,0.1)]"><p className="leading-[18px] text-[#5d6474]">{t("Задачи в ожидании")}</p><b className="mt-[4px] block text-[14px] font-semibold leading-[18px]">0</b><p className="mt-[10px] leading-[18px] text-[#5d6474]">{t("Сделанные задачи")}</p><b className="mt-[4px] block text-[14px] font-semibold leading-[18px]">0</b></div>
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
      {state.availability && <AvailabilityDialog onClose={closeAvailability} />}
      {state.shelfShare && <ShelfShareDialog onClose={closeShelfShare} />}
      {state.openShop > 0 && (
        <ClientDrawer key={state.openShop} clientId={state.openShop} onClose={closeShop} onMissing={keepMissingShop} editHref={canEditShop ? `/clients?openShop=${state.openShop}&openUpdateDialog=true` : undefined} />
      )}
    </RefPage>
  );
}
