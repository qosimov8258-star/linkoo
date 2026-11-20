"use client"

import type { ReactNode } from "react"

import { RI } from "@/components/ref/list-kit"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

import { num } from "./supplier-return-card"
import type { Supplier } from "./suppliers-data"

// The card of a supplier (Linko's ProviderDetail of #/provider/<id>), opened in place of its row:
// - a 65 px title bar with the name (a click on it closes the card) and «Добавить запас», «Изменить», «Удалить»;
// - left (27 %): Адрес («N/A» when empty), Категория, Филиал, Организация («Не указано» when empty), «Дата добавления»
//   (the card's last change, Linko's modified_date) and «Контакты» (name, email, phone per row);
// - right (73 %): the reserve («Добавить запас») as Продукт / Кол-во / Цена / Сумма, «Указан вручную» in green for a cost
//   given by hand.

const ADD_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
/** Linko's .dottedList rule: the dotted image along the bottom of a row. */
const DOTTED = "relative after:absolute after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
// Linko's product table: xs3 Продукт, xs2 Кол-во, xs2 Цена, xs2 Сумма, xs3 «Указан вручную»; rows stick out 8 px.
const PRODUCT_COLS = "-mx-[8px] grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,3fr)]"
const CELL = "px-[8px]"

function TitleButton({ label, path, onClick }: { label: string; path: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} data-tip-side="bottom" onClick={onClick} className="relative z-[1] flex h-12 w-12 justify-center pt-[12px]">
      {/* Material's 20 px icon in a 48 px button: 12 px from the top. */}
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}

function Description({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between leading-[16.25px]">
      <div className="mb-[5px] font-semibold">{label}</div>
      <div>{children}</div>
    </div>
  )
}

export function SupplierDetail({ supplier, onClose, onReserve, onEdit, onDelete }: { supplier: Supplier; onClose: () => void; onReserve: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t, language } = useLanguage()
  const named = (value: string) => (!value.trim() || value.trim() === "Не указано" ? t("Не указано") : value)
  const contacts = supplier.contacts
  return (
    <div className="border-b border-dotted border-[#eee] bg-white text-left text-[13px] text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <button type="button" aria-label={t("Свернуть")} tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-pointer" />
        <div className="pointer-events-none relative text-[18px] font-semibold leading-[22.5px] text-[#333]">{supplier.name}</div>
        <div className="relative flex justify-end">
          <TitleButton label={t("Добавить запас")} path={ADD_CIRCLE} onClick={onReserve} />
          <TitleButton label={t("Изменить")} path={RI.edit} onClick={onEdit} />
          <TitleButton label={t("Удалить")} path={RI.trash} onClick={onDelete} />
        </div>
      </div>
      <div className="flex">
        <div className="shrink-0 basis-[27%] border-r border-[#efefef] px-[30px] py-[20px]">
          <Description label={t("Адрес")}>{supplier.address || "N/A"}</Description>
          <Description label={t("Категория")}>{named(supplier.category)}</Description>
          <Description label={t("Филиал")}>{named(supplier.branch)}</Description>
          <Description label={t("Организация")}>{named(supplier.organization)}</Description>
          <Description label={t("Дата добавления")}>
            <span data-no-translate>{formatDateText(supplier.modifiedDate || supplier.createdDate, language, { withTime: false })}</span>
          </Description>
          <div className="py-[20px] leading-[16.25px]">
            <div className="mb-[5px] font-semibold">{t("Контакты")}</div>
            {contacts.map((contact, index) => {
              // Linko's rows: 10 px above and below, none above the first and none below the last (a single row keeps
              // the 10 px above); the dotted rule (8 px in from both ends) under every row but the last.
              const last = index === contacts.length - 1
              const padding = last ? "pt-[10px]" : index === 0 ? "pb-[10px]" : "py-[10px]"
              return (
                <div key={contact.id} className={`-mx-[8px] grid grid-cols-3 ${padding} ${last ? "" : `${DOTTED} after:inset-x-[8px]`}`}>
                  <span className={`${CELL} break-words`}>{contact.name}</span>
                  <span className={`${CELL} break-words`}>{contact.email}</span>
                  <span className={`${CELL} break-words text-right`}>{contact.phone}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="w-full basis-[73%] px-[10px]">
          <div className={`${PRODUCT_COLS} ${DOTTED} after:inset-x-0 py-[20px] leading-[16.25px]`}>
            <span className={CELL}>{t("Продукт")}</span>
            <span className={CELL}>{t("Кол-во")}</span>
            <span className={CELL}>{t("Цена")}</span>
            <span className={CELL}>{t("Сумма")}</span>
            <span />
          </div>
          {supplier.products.map((line) => {
            const currency = line.currency || "SUM"
            const cost = Number(line.price) || 0
            return (
              // Linko's 50 px row keeps the global 20 px top padding, so its text sits 19 px down, not centred.
              <div key={line.id} className={`${PRODUCT_COLS} ${DOTTED} after:inset-x-0 h-[50px] items-start pt-[20px] leading-[16.25px]`}>
                <span className={CELL}>{line.product}</span>
                <span className={CELL}>{line.qty}</span>
                {/* Linko: a line without a cost reads «Нету поставки». */}
                <span className={CELL}>{cost ? `${num(cost)} ${currency}` : t("Нету поставки")}</span>
                <span className={CELL}>{cost ? `${num(cost * line.qty)} ${currency}` : ""}</span>
                <span className={CELL}>{line.manual ? <span className="text-[#6fc988]">{t("Указан вручную")}</span> : null}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
