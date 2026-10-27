// Login and password rules, shared by the users API, the password-change API
// and the forms (no server-only imports, so client components can use them).

export const USERNAME_MIN = 3
export const USERNAME_MAX = 64
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

/** Canonical login: Unicode NFKC (full-width / compatibility forms folded),
 * trimmed and lower-cased, so 'ADMIN' and 'admin' are the same account. */
export function normalizeUsername(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase()
}

// Letters (incl. modifier letters such as the Uzbek ʻ), combining marks, digits
// and . _ - @ only: no spaces, no markup, no invisible format/control characters
// (zero-width space, joiners, bidi marks), which make look-alike logins.
const USERNAME_ALLOWED = /^[\p{L}\p{M}\p{N}._@-]+$/u

/** Error message (Russian i18n key) for an invalid login, or null when valid. */
export function usernameProblem(normalized: string): string | null {
  if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX) return "Логин должен содержать от 3 до 64 символов"
  if (!USERNAME_ALLOWED.test(normalized)) return "Логин может содержать только буквы, цифры и символы . _ - @"
  return null
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
  "abcdefgh",
  "abcd1234",
  "admin123",
  "administrator",
  "iloveyou",
  "parol123",
  "пароль123",
  "йцукенгш",
])

/** Error message (Russian i18n key) for a weak password, or null when it passes. */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN) return "Пароль должен содержать не менее 8 символов"
  if (password.length > PASSWORD_MAX) return "Пароль слишком длинный"
  if (/^\d+$/.test(password)) return "Пароль не может состоять только из цифр"
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower) || new Set(lower).size < 4) return "Пароль слишком простой"
  if (username && lower === normalizeUsername(username)) return "Пароль не должен совпадать с логином"
  return null
}
