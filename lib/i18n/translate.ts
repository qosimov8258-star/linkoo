import { en } from "./dictionaries/en"
import { tk } from "./dictionaries/tk"
import { uz } from "./dictionaries/uz"
import type { LanguageCode } from "./types"

type TargetLanguage = Exclude<LanguageCode, "ru">

const dictionaries: Record<TargetLanguage, Record<string, string>> = {
  uz,
  tk,
  en,
}

// Russian month forms (nominative, genitive, abbreviated) -> month index.
const MONTH_FORMS: Array<[RegExp, number]> = [
  [/январ[ьяю]|янв/i, 0],
  [/феврал[ьяю]|фев(?:р)?/i, 1],
  [/март[а]?|мар/i, 2],
  [/апрел[ьяю]|апр/i, 3],
  [/ма[йя]/i, 4],
  [/июн[ьяю]?/i, 5],
  [/июл[ьяю]?/i, 6],
  [/август[а]?|авг/i, 7],
  [/сентябр[ьяю]|сен(?:т)?/i, 8],
  [/октябр[ьяю]|окт/i, 9],
  [/ноябр[ьяю]|ноя(?:б)?/i, 10],
  [/декабр[ьяю]|дек/i, 11],
]

const MONTHS: Record<TargetLanguage, { full: string[]; short: string[] }> = {
  uz: {
    // The reference app's moment "uz" locale (updateLocale): lowercase, no dots.
    full: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
    short: ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"],
  },
  tk: {
    full: ["Ýanwar", "Fewral", "Mart", "Aprel", "Maý", "Iýun", "Iýul", "Awgust", "Sentýabr", "Oktýabr", "Noýabr", "Dekabr"],
    short: ["Ýan.", "Few.", "Mar.", "Apr.", "Maý", "Iýun", "Iýul", "Awg.", "Sen.", "Okt.", "Noý.", "Dek."],
  },
  en: {
    full: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
}

const MONTH_WORD = /(?<![А-Яа-яЁё])(январ[ьяю]|феврал[ьяю]|март[а]?|апрел[ьяю]|ма[йя]|июн[ьяю]?|июл[ьяю]?|август[а]?|сентябр[ьяю]|октябр[ьяю]|ноябр[ьяю]|декабр[ьяю]|янв\.?|фев(?:р\.?)?|мар\.?|апр\.?|авг\.?|сен(?:т\.?)?|окт\.?|ноя(?:б\.?)?|дек\.?)(?![А-Яа-яЁё])/gi

const NUMBER_TOKEN = /\d+(?:[ .,]\d+)*/g

// Some reference pages print dates with Russian month names even in the uz interface (moment locale "ru");
// the DOM translator switches this on for those routes (see REFERENCE_RU_DATE_ROUTES).
let keepRussianMonths = false
export function setKeepRussianMonths(value: boolean) {
  keepRussianMonths = value
}

function translateMonths(lang: TargetLanguage, text: string): string {
  if (keepRussianMonths && lang === "uz") return text
  return text.replace(MONTH_WORD, (word) => {
    const index = MONTH_FORMS.findIndex(([form]) => new RegExp(`^(?:${form.source})$`, "i").test(word.replace(/\.$/, "")))
    if (index < 0) return word
    const isAbbreviation = word.endsWith(".") || word.length <= 3
    const names = isAbbreviation ? MONTHS[lang].short : MONTHS[lang].full
    return names[index]
  })
}

// Strings that mix a Latin title with Russian glue words ("Sotuvlar на 13 октября").
function translateGlue(lang: TargetLanguage, text: string): string {
  // The reference keeps the Russian "на" next to uz dates ("Sotuvlar на 25 oktyabr") and says "on" in English.
  const joiner = lang === "en" ? " on " : lang === "uz" ? " на " : " — "
  return text.replace(/\sна\s(?=\d)/g, joiner).replace(/\s*г\.(?=,|\s|$)/g, "")
}

// Whole-phrase fallback for strings built by concatenation ("Выбрано филиалов: 3",
// "Дата: 12 окт"): every dictionary phrase found inside the text is replaced.
// Skipped for text that looks like data (names with Latin words, SKUs).
const KNOWN_LATIN = /^(?:Excel|EXCEL|PDF|KPI|SUM|USD|Euro|EUR|Telegram|Linko|API|GPS|JSON|CSV|Perfect|Store|ID|IP|SKU|AKB|OKB|ABC|PnL|P&L|HTML|URL|SMS|QR|ИНН|IKPU|USB|PC|NDS|VAT|TIN|WhatsApp|Bot|bot|Vansell|Vansel|KG|kg|ml|L|Wi|Fi)$/
const PHRASE_CACHE = new Map<TargetLanguage, { regex: RegExp | null; map: Map<string, string> }>()

function phraseIndex(lang: TargetLanguage) {
  let entry = PHRASE_CACHE.get(lang)
  if (!entry) {
    const map = new Map<string, string>()
    for (const [key, value] of Object.entries(dictionaries[lang])) {
      if (key.length >= 4 && /[А-Яа-яЁё]/.test(key) && !key.includes("{n}") && value) map.set(key, value)
    }
    const alternatives = [...map.keys()]
      .sort((a, b) => b.length - a.length)
      .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    entry = {
      regex: alternatives.length ? new RegExp(`(?<![А-Яа-яЁё])(?:${alternatives.join("|")})(?![А-Яа-яЁё])`, "g") : null,
      map,
    }
    PHRASE_CACHE.set(lang, entry)
  }
  return entry
}

function looksLikeData(text: string) {
  return (text.match(/[A-Za-z][A-Za-z0-9'’]{2,}/g) ?? []).some((word) => !KNOWN_LATIN.test(word))
}

function translatePhrases(lang: TargetLanguage, text: string): string {
  // Logins, e-mails and similar identifiers are data, never translate parts of them.
  if (looksLikeData(text) || /[А-Яа-яЁё]\.[А-Яа-яЁё]|_|@/.test(text)) return text
  const { regex, map } = phraseIndex(lang)
  if (!regex) return text
  let covered = 0
  const result = text.replace(regex, (match) => {
    covered += match.replace(/[^А-Яа-яЁё]/g, "").length
    return map.get(match) ?? match
  })
  // Only accept when the dictionary explains (almost) all Russian letters; otherwise
  // the rest is a name or other data and a half-translated mix would look wrong.
  const total = text.replace(/[^А-Яа-яЁё]/g, "").length
  return total > 0 && covered / total >= 0.75 ? result : text
}

// Uses the original Russian source text as the dictionary key, so any string
// that hasn't been translated yet simply falls back to showing the Russian
// original instead of breaking — translations can be filled in incrementally.
//
// Beyond exact keys it understands numeric templates ("Оплаты: {n} точек", where
// every number in the text is a {n} slot, filled back in order) and Russian
// month names, so dates and counters don't each need their own key.
export function translate(lang: LanguageCode, text: string): string {
  if (lang === "ru") return text
  const dictionary = dictionaries[lang]
  const exact = dictionary[text]
  if (exact !== undefined) return exact
  if (!/[А-Яа-яЁё]/.test(text)) return text

  const numbers: string[] = []
  const template = text.replace(NUMBER_TOKEN, (match) => {
    numbers.push(match)
    return "{n}"
  })
  if (numbers.length > 0) {
    const translated = dictionary[template]
    if (translated !== undefined) {
      let index = 0
      return translated.replace(/\{n\}/g, () => numbers[index++] ?? "")
    }
  }

  const withMonths = translateMonths(lang, text)
  if (withMonths !== text) return translateGlue(lang, withMonths)
  return translatePhrases(lang, text)
}

/** True when the text still contains Russian letters after translating into `lang`. */
export function isUntranslated(lang: LanguageCode, text: string): boolean {
  return lang !== "ru" && /[А-Яа-яЁё]/.test(translate(lang, text))
}
