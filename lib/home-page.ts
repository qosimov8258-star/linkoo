// The page a user lands on: after signing in (app/login), after the first
// password change, and when the site is entered at its bare address "/"
// (app/page.tsx; links inside the app to "/" keep opening the dashboard).
// The user's decision (2026-11-19): Персонал → Должности, instead of the
// dashboard. The dashboard stays at "/" with its own parameters
// (/?widgets=1 from Аналитика → Виджеты, /?beginDate=…&endDate=…, /?toggleTab=…).
export const HOME_PAGE = "/analytics/positions"
