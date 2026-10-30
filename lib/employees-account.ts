import "server-only"

import { hashPassword } from "@/lib/auth"
import { USER_EMPLOYEE_INDEX } from "@/lib/auth-employee"
import { normalizeUsername, passwordProblem, usernameProblem } from "@/lib/auth-policy"
import { isUniqueViolation } from "@/lib/auth-request"
import type { PgDb } from "@/lib/db"
import type { Role } from "@/lib/session"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

// The sign-in account (users) of an employee, kept by the Сотрудники form. Saving an employee with
// "Доступ к системе" on, a login and a password creates the account linked to it (users.employee_id);
// an account that exists is updated instead: a changed login renames it, a new password resets it and
// the employee's access right becomes the account's (not an administrator's account: rights do not
// apply to it). The rules are the ones of Права доступа →
// Пользователи (lib/users-repo.ts, app/api/users): the login normalised (NFKC, lower case) and unique
// case-insensitively among the accounts, the same password policy and hashing, a new account gets the
// role that page gives a non-administrator ("manager", never "admin") and must replace its password
// at the first sign-in, as after every reset; a reset, or a changed access right, ends the account's
// sessions. Only an administrator (the only one who may manage accounts there) sets a login, a
// password or an account's access right here. Passwords are hashed before the transaction and never
// stored on employees nor returned. Whether the account may sign in stays decided by the employee
// (active, "Доступ к системе"; lib/auth-employee.ts). An employee that only has a login (older rows,
// or saved without a password) gets no account until an administrator saves a password.

/** The role of an account created from the employee form (the default of Права доступа → Пользователи). */
export const EMPLOYEE_ACCOUNT_ROLE: Role = "manager"

/** Refusal for a user who may not manage sign-in accounts (Russian i18n key). */
export const ACCOUNT_ADMIN_ONLY = "Логин, пароль и права доступа для входа может задавать только администратор"

/** Who saves the employee (the signed-in user). */
export type AccountActor = { id: number; role: Role }

export type AccountError = "bad_login" | "weak_password" | "login_taken" | "account_forbidden" | "required"

/** A refused login / password: the form field and, when it is not the error's usual one, the message. */
export type AccountFailure = { error: AccountError; field: "login" | "password" | "accessRightId"; message?: string }

/** The login and password of a save, checked (and the password hashed) before any transaction. */
export type AccountRequest = {
  /** The login as typed, normalised like an account's ("" while "Доступ к системе" is off). */
  login: string
  /** bcrypt hash of a new password, or null when none was typed. */
  hash: string | null
}

/** Checks the password of a save (policy, administrator only) and hashes it. A password is only
 * read while "Доступ к системе" is on (the form shows the field then). */
export async function prepareAccount(
  input: { systemAccess: boolean; login: string; password: string },
  actor: AccountActor,
): Promise<{ request: AccountRequest } | { failure: AccountFailure }> {
  const login = input.systemAccess ? normalizeUsername(input.login) : ""
  const password = input.systemAccess ? input.password : ""
  if (!password) return { request: { login, hash: null } }
  if (actor.role !== "admin") return { failure: { error: "account_forbidden", field: "password" } }
  const weak = passwordProblem(password, login)
  if (weak) return { failure: { error: "weak_password", field: "password", message: weak } }
  return { request: { login, hash: await hashPassword(password) } }
}

type AccountRow = { id: number; username: string; display_name: string; role: string; access_right_id: number | null }

/** What a save does to the account. */
export type AccountPlan = {
  /** The value stored in employees.login (the account's login while one is linked). */
  login: string
  account: AccountRow | null
  /** Create the account (no account yet, "Доступ к системе" on, a login and a new password). */
  create: boolean
  /** New login of the linked account, or null. */
  rename: string | null
  hash: string | null
  /** Access right to give the account; undefined keeps its own. */
  accessRightId: number | undefined
  /** New display name of the account (it followed the employee's name), or undefined. */
  displayName: string | undefined
}

/** Serialises the logins of the employee form and of Права доступа → Пользователи (lib/users-repo.ts
 * createUser takes the same 'users:create' lock), so two parallel saves can never take one login or
 * create two accounts. Take it before the employee row is locked. */
export async function lockAccountLogins(tx: PgDb): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('employees:login'))").get()
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('users:create'))").get()
}

/** The account linked to the employee (its row is locked until the save commits). */
async function linkedAccount(tx: PgDb, employeeId: number): Promise<AccountRow | null> {
  const row = (await tx
    .prepare("SELECT id, username, display_name, role, access_right_id FROM users WHERE employee_id = ? ORDER BY id LIMIT 1 FOR UPDATE")
    .get(employeeId)) as AccountRow | undefined
  if (!row) return null
  return { ...row, id: Number(row.id), role: String(row.role), access_right_id: row.access_right_id === null ? null : Number(row.access_right_id) }
}

/** Decides, inside the save's transaction (after lockAccountLogins and the employee row lock), what
 * happens to the employee's account. `current` is the stored employee (null for a new one);
 * `accessRightId` the resolved access right of the save. */
export async function planAccount(
  tx: PgDb,
  args: {
    current: { id: number; login: string; accessRightId: number | null; name: string } | null
    systemAccess: boolean
    accessRightId: number | null
    name: string
    request: AccountRequest
    actor: AccountActor
  },
): Promise<{ plan: AccountPlan } | { failure: AccountFailure }> {
  const { current, request, actor } = args
  const account = current ? await linkedAccount(tx, current.id) : null
  const displayName = account && current && args.name !== current.name && account.display_name === current.name ? args.name : undefined
  const plan: AccountPlan = { login: account ? account.username : "", account, create: false, rename: null, hash: null, accessRightId: undefined, displayName }
  if (!args.systemAccess) return { plan }

  const stored = account ? account.username : (current?.login ?? "").trim()
  const unchanged = normalizeUsername(stored) === request.login
  if (!unchanged && actor.role !== "admin") return { failure: { error: "account_forbidden", field: "login" } }
  const create = !account && request.hash !== null
  // A new or changed login, and the login of a new account, follow the accounts' rules; an unchanged
  // older login of an employee without an account is kept as it is.
  const login = unchanged && !create ? stored : request.login
  if (!unchanged || create) {
    const problem = usernameProblem(login)
    if (problem) return { failure: { error: "bad_login", field: "login", message: problem } }
    const employee = await tx.prepare("SELECT 1 FROM employees WHERE lower(login) = lower(@login) AND id <> @id LIMIT 1").get({ login, id: current?.id ?? 0 })
    const user = await tx.prepare("SELECT 1 FROM users WHERE lower(username) = lower(@login) AND id <> @id LIMIT 1").get({ login, id: account?.id ?? 0 })
    if (employee || user) return { failure: { error: "login_taken", field: "login" } }
  }
  plan.login = login
  plan.create = create
  plan.rename = account && !unchanged ? login : null
  plan.hash = request.hash

  // The account's access right is the employee's (an administrator's save copies it onto the account).
  // Access rights do not apply to an administrator's account (lib/current-user.ts ignores them), so its
  // own is never touched: no meaningless right is written and its sessions are not ended.
  const right = args.accessRightId
  // Never an account without an access right (it would not be restricted at all).
  if (create && right === null) return { failure: { error: "required", field: "accessRightId" } }
  if (create) plan.accessRightId = right ?? undefined
  else if (account && right !== null) {
    const accountRight = account.role === "admin" ? null : account.access_right_id
    if (actor.role === "admin") {
      if (account.role !== "admin" && right !== account.access_right_id) plan.accessRightId = right
    } else if (right !== (current?.accessRightId ?? null) && right !== accountRight) {
      // A non-administrator keeps the employee's access right, or takes the one the account already has
      // (the form shows it when only an earlier link set it); never a right that changes the account's.
      return { failure: { error: "account_forbidden", field: "accessRightId" } }
    }
  }
  return { plan }
}

/** Writes the plan for the saved employee. Returns the account id and whether its sessions must end
 * (a new password or access right): call endAccountSessions after the transaction commits. */
export async function applyAccount(tx: PgDb, employeeId: number, name: string, plan: AccountPlan): Promise<{ accountId: number | null; endSessions: boolean }> {
  if (plan.create) {
    const result = await tx
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, access_right_id, must_change_password, employee_id)
         VALUES (@username, @displayName, @hash, @role, @accessRightId, 1, @employeeId)`,
      )
      .run({ username: plan.login, displayName: name || plan.login, hash: plan.hash, role: EMPLOYEE_ACCOUNT_ROLE, accessRightId: plan.accessRightId ?? null, employeeId })
    return { accountId: Number(result.lastInsertRowid), endSessions: false }
  }
  const account = plan.account
  if (!account) return { accountId: null, endSessions: false }
  const setAccess = plan.accessRightId !== undefined
  if (plan.rename === null && plan.hash === null && !setAccess && plan.displayName === undefined) return { accountId: account.id, endSessions: false }
  await tx
    .prepare(
      `UPDATE users SET
         username = COALESCE(@rename::text, username),
         display_name = COALESCE(@displayName::text, display_name),
         access_right_id = CASE WHEN @setAccess::boolean THEN @accessRightId::int ELSE access_right_id END,
         password_hash = COALESCE(@hash::text, password_hash),
         must_change_password = CASE WHEN @hash::text IS NOT NULL THEN 1 ELSE must_change_password END,
         password_changed_at = CASE WHEN @hash::text IS NOT NULL THEN datetime('now') ELSE password_changed_at END
       WHERE id = @id`,
    )
    .run({
      id: account.id,
      rename: plan.rename,
      displayName: plan.displayName ?? null,
      setAccess,
      accessRightId: plan.accessRightId ?? null,
      hash: plan.hash,
    })
  return { accountId: account.id, endSessions: plan.hash !== null || setAccess }
}

/** Ends the account's sessions after a reset (the old password and rights must not keep working). */
export async function endAccountSessions(outcome: { accountId: number | null; endSessions: boolean } | null): Promise<void> {
  if (outcome?.accountId && outcome.endSessions) await revokeAllSessionsForUser(outcome.accountId)
}

/** A unique violation of users: "login" when the login is taken (refuse with login_taken), "employee"
 * when the employee got an account meanwhile (save again: it is then updated), else null. */
export function accountConflict(error: unknown): "login" | "employee" | null {
  if (!isUniqueViolation(error)) return null
  const constraint = String((error as { constraint?: unknown }).constraint ?? "")
  if (constraint === USER_EMPLOYEE_INDEX) return "employee"
  return constraint.startsWith("users_") ? "login" : null
}
