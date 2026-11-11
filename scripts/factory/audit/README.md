# Factory audit scripts (local only)

Edge-case and abuse tests of the factory simulation (`../README.md`): they run against the local factory server
(`http://localhost:3001`, database `linko_factory`) as the factory's administrator. Most of them **write data**
(test orders, payments, transfers, deleted records), so take a snapshot first and restore it afterwards:

```bash
docker exec linko-business-dashboard-postgres-1 pg_dump -U linko -Fc linko_factory > /tmp/linko_factory.dump
# … run the scripts …
D="docker exec -i linko-business-dashboard-postgres-1"
$D psql -U linko -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='linko_factory'"
$D psql -U linko -d postgres -c "drop database linko_factory" -c "create database linko_factory"
$D pg_restore -U linko -d linko_factory < /tmp/linko_factory.dump
```

(`pg_restore --clean` does not work on this database: the `datetime()` function is used by column defaults.) Restart the
:3001 server after a restore: it remembers the tables it created lazily since it started, and a table the dump does not
have answers 500 until the restart.

| Script | What it does | Expected |
| --- | --- | --- |
| `fuzz.mjs [routeRegex]` | every POST / PUT / PATCH / DELETE route (`app/api/**/route.ts`) with invalid JSON, `{}`, `[]`, `null`, hostile values and ids `999999999` / `abc` / `-1` | only 4xx; prints every 5xx or 2xx |
| `getfuzz.mjs` | every GET route with bad ids (`abc`, `1.5`) and bad paging / date / search parameters | no 5xx |
| `scen1.mjs` | orders: shortages, zero / negative / huge values, status path, payments, cancel / delete of a delivered order | refusals with clear messages; stock and client balance follow the status |
| `scen2.mjs` | write-offs, transfers (manual give / accept), supplier incomings, cash transfers / expenses, production batches | no negative stock or cash |
| `scen3.mjs` | deletes of records in use, duplicates, salary input errors | 409 with the usage list; duplicates refused |
| `scen4.mjs` | Персонал: salary after «Зачислить», attendance, tasks, positions, KPI | a credited salary cannot change until «Отменить зачисление» |
| `scen5.mjs` | Клиенты and client returns | over-returns and foreign orders refused |
| `scen6.mjs` | cash: lowering / deleting an income that was already spent, deleting a transfer | «Недостаточно средств в кассе» |
| `scen7.mjs` | stock counts and supplier returns | negative / future / double confirm refused |
| `conc.mjs` | parallel orders for the last units, parallel payments, transfers and expenses | exactly one of each wins |
| `perm.mjs` | signs in as limited employees (agent, deliverer, keeper, cashier) and probes reads and writes | company money (salaries, P&L, balances) and writes answer 403 |
| `sec-authz.mjs` | the authorization matrix: every API route × method as nobody, a viewer, a role-only manager, one employee of every access right and the administrator (writes with `{}` and the id `999999999`) | nobody: only 401; a viewer or an access right without the route's permission: 403 on every write; no 5xx. `authz-reads.tsv` lists what each account can read |
| `sec-session.mjs` | sign-in and session: cookie flags, tampered / forged tokens (also signed with the real `AUTH_SECRET` of `.env`), forced password change, sign-out, other accounts' sessions, password guessing and the lock-out of an account under attack, cross-site requests, body size, security headers | `all checks passed` |
| `sec-field.mjs` | two sales agents, a supervisor and a cashier through the mobile API (`/api/mobile/**`: visits, GPS, photos) and the field reads: each tries to see or change what belongs to somebody else | `all checks passed` |
| `sec-xss.cjs` | in a browser: a client, an expense category, a client type and a brand whose names are markup, then the pages that list them, chart tooltips and map popups (`PW_CORE`, `CHROME`) | no payload runs, no dialog, no Content-Security-Policy violation |
| `sec-inject.mjs [routeRegex]` | every query parameter (and path id) of every GET route with SQL / template / markup payloads, one at a time (`WORKERS` sessions in parallel) | no 5xx, no answer delayed by `pg_sleep`, no payload echoed in HTML |
| `formfuzz.cjs [routeRegex]` | opens every «Добавить / Создать» dialog of every page (`tools/reference-test/routes.txt`), submits it empty, then with hostile text / numbers (`SHARD=i/n` for parallel workers) | no page errors or 5xx; dialogs stay open on invalid input |

The `sec-*` scripts create their own accounts (`sec.viewer`, `sec.manager`, `sec.s1` … `sec.s6`, `sec.v<time>`) and records
("XSS probe …", a few visits and photos of today), and `sec-authz.mjs`
changes the first passwords of one employee per access right to `<initial>-New9`, like `perm.mjs`. The browser scripts
(`formfuzz.cjs`, `sec-xss.cjs`, `../ui-check.cjs`) take `PW_CORE=<folder of a playwright-core install>` and `CHROME=<browser binary>`
when `tools/reference-test/node_modules` is not installed.

The `sec-*` scripts and `../ui-check.cjs` take `FACTORY_URL` (another local port, e.g. the production image:
`docker build -t mezon-test . && docker run --rm -p 127.0.0.1:3011:3000 -e DATABASE_URL=…host.docker.internal:5437/linko_factory
-e AUTH_SECRET=… -e ALLOWED_ORIGIN=http://localhost:3011 mezon-test`, far faster than `next dev` and with production's
cookie and Content-Security-Policy settings) and `FACTORY_USER` / `FACTORY_PASS` (`ui-check.cjs` as an employee shows what
that access right can open: the refused API calls are listed as `http 403`).

Output files go to `.ui-check/audit/` (git-ignored, `AUDIT_OUT` to change). `perm.mjs` changes the employees' first
passwords (forced change at the first sign-in) to `<initial>-New9`.
