# Reference test ("test qil")

Playwright scripts that compare this app (http://localhost:3000) with the reference app.linko.uz.
The reference is the user's live account: these scripts only navigate, read and screenshot there.
Create/edit/delete is tested on the local app only.

Setup (once): `npm i --no-save playwright-core@1.48` in this folder. Chromium comes from
`~/Library/Caches/ms-playwright/chromium-1248`.

Run in order (from this folder, local `pnpm dev -p 3000` running):

1. `REF_SERVER=… REF_USER=… REF_PASS=… node login.js` saves `ref.json` / `local.json` sessions.
2. Build `routes.txt` (every local page): see the command in the memory note `test-qil-procedure`.
3. `node crawl.js` opens every route, logs page errors, console errors and failed API calls.
4. `node buttons.js` clicks every non-destructive button on every page (no delete/save/confirm).
5. `node locmenu.js` reads the local top-menu links into `localmenu.json`.
6. `node compare.js` opens each menu item in both apps (reference via its own menu), screenshots both into
   `pages/NNN-ref.png` / `pages/NNN-loc.png` and diffs buttons/headers/filters into `compare.json`.
7. `node crud.js <path> …` (and `crud2.js` for dialogs with dropdowns, `crud-ed.js path|name` for edit/delete)
   creates, edits and deletes a "QA test …" row on local settings pages. Remove any leftover QA rows afterwards.
8. `node bal.js <path> …` snapshots page text (balances, P&L) before/after a data change.
9. `node xhr.js <reference url>` prints the reference's API calls on a page (to read its real data/order).
10. `node refget.js '<reference hash route>' '<api substring>' '<api url>' refdata/x.json` downloads a reference API list
    (read-only, all pages) into `refdata/` (git-ignored). `empdeltas.js` / `dlvdeltas.js` compare Баланс сотрудников /
    Долги доставщиков with those dumps and write the per-row deltas used by the parity seeds in scripts/demo.
11. `node crudx.js '<json spec>'` create/edit/delete on a dialog with named fields, dropdowns and extra clicks
    (e.g. the clock picker of Смены); `edit1.js <path> <name>` prints the PUT a row edit sends.
