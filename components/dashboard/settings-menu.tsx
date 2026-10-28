"use client"

import Link from "next/link"

import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"
import { settingsNavGroups } from "@/lib/settings-nav"

const languages: { code: LanguageCode; label: string }[] = [
  { code: "ru", label: "RU" },
  { code: "uz", label: "UZ" },
  { code: "tk", label: "TK" },
  { code: "en", label: "EN" },
]

interface SettingsMenuProps {
  onClose: () => void
}

/** Right-hand "Настройки" drawer: the whole panel (header included) scrolls, like the reference. */
export function SettingsMenu({ onClose }: SettingsMenuProps) {
  const { language, setLanguage, t } = useLanguage()

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[1200] bg-black/[0.54]" />
      <div className="fixed right-0 top-0 z-[1300] h-full w-[340px] max-w-full overflow-y-auto bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="flex h-[69px] items-center justify-between border-b border-[#efefef] py-[10px] pl-[30px] pr-[10px]">
          <div>
            <p className="text-[16px] font-semibold leading-5">{t("Настройки")}</p>
            <span className="block text-[14px] font-medium leading-[17.5px]">{t("Версия")}: 7.1.61 (API: 147)</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center rounded-[5px]">
            <svg viewBox="0 0 24 24" className="h-[25px] w-[25px] fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        <div className="px-[30px] py-[10px] text-center">
          <a href="tel:+998785555525" className="block text-[15px] font-semibold leading-[18.75px] text-[#129fdd] hover:underline">
            {t("Онлайн техподдержка")}
          </a>
          <span className="mt-[5px] block text-[20px] font-semibold leading-[25px]">+998 78 555-55-25</span>
        </div>

        <div className="border-b border-[#efefef] px-[26px] py-[10px]">
          <div className="flex w-[280px]">
            {languages.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                className={`h-8 w-[70px] rounded-[5px] border text-[13px] ${language === code ? "border-[#2bcd53] bg-[#2bcd53] text-white" : "border-[#e6e6e6] bg-white text-black"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-[#efefef] px-[26px] py-[10px]">
          <Link href="/about" onClick={onClose} className="flex h-[50px] items-center justify-between rounded-[10px] bg-[#405cf5] p-[10px] text-[18px] font-semibold text-white">
            <span className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nav/knowledge-bulb.png" alt="" className="h-[30px] w-[30px]" />
              <span className="ml-[10px]">{t("База знаний")}</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </Link>
        </div>

        <div className="px-[30px] py-[10px]">
          {settingsNavGroups.map((section) => (
            <ul key={section.title} className="mb-[20px] pb-[10px]">
              <li className="text-[13px] font-bold leading-4">{t(section.title)}</li>
              {section.items.map((item) =>
                item.href ? (
                  <li key={item.label} className="pl-[20px] pt-[10px]">
                    <Link href={item.href} onClick={onClose} className="block text-[13px] leading-[16.25px] hover:text-[#4f71dc]">
                      {t(item.label)}
                    </Link>
                  </li>
                ) : (
                  <li key={item.label} className="pl-[20px] pt-[10px]">
                    <span className="block cursor-not-allowed text-[13px] leading-[16.25px] text-[#999]" title={t("Скоро будет доступно")}>
                      {t(item.label)}
                    </span>
                  </li>
                ),
              )}
            </ul>
          ))}
        </div>
      </div>
    </>
  )
}
