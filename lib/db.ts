import "server-only"

import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"

import { clients as seedClients } from "@/components/clients/clients-data"
import { initialOrders as seedOrders } from "@/components/orders/orders-data"
import { knownCurrencies as seedCurrencies } from "@/components/analytics/currencies-data"
import { knownCashboxes as seedCashboxes } from "@/components/analytics/cashboxes-data"
import { knownIncomeCategories as seedIncomeCategories } from "@/components/analytics/income-categories-data"
import { knownExpenseCategories as seedExpenseCategories } from "@/components/analytics/expense-categories-data"
import { initialCustomerPayments as seedCustomerPayments } from "@/components/analytics/customer-payments-data"
import { initialSupplierPayments as seedSupplierPayments } from "@/components/analytics/supplier-payments-data"
import { knownOrganizations as seedOrganizations } from "@/components/analytics/organization-data"
import { knownUnitsOfMeasure as seedUnitsOfMeasure } from "@/components/analytics/units-of-measure-data"
import { knownProductTypes as seedProductTypes } from "@/components/analytics/product-types-data"
import { knownBrands as seedBrands } from "@/components/analytics/brands-data"
import { knownPriceLists as seedPriceLists } from "@/components/analytics/price-lists-data"
import { hashPassword } from "@/lib/auth"

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "app.db")

// Login identifier for the seeded admin account, in "998XXXXXXXXX" form
// (no leading "+"), matching the phone-number login screen.
export const ADMIN_PHONE = "998901234567"

declare global {
  var __linkoDb: Database.Database | undefined
}

function createConnection(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      inn TEXT,
      type TEXT NOT NULL DEFAULT '',
      zone TEXT NOT NULL DEFAULT '',
      zone_agent TEXT NOT NULL DEFAULT 'Не указано',
      agent TEXT NOT NULL DEFAULT 'Не указано',
      deliverer TEXT NOT NULL DEFAULT 'Не указано',
      collector TEXT NOT NULL DEFAULT 'Не указано',
      balance REAL,
      tab TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      zone TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '',
      delivery TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT 'Admin Ritm',
      amount TEXT NOT NULL DEFAULT '0 SUM',
      balance TEXT NOT NULL DEFAULT '0 SUM',
      negative INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Есть на складе',
      discount TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS currencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      rate REAL NOT NULL DEFAULT 1,
      is_base INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cashboxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SUM',
      cashier TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '',
      vansell INTEGER NOT NULL DEFAULT 0,
      order_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS income_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parameter TEXT NOT NULL DEFAULT '',
      other_income INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parameter TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
      direct INTEGER NOT NULL DEFAULT 0,
      exclude_from_pnl INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client TEXT NOT NULL,
      client_code TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      accepted_at TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      amount_sum_equivalent REAL,
      cash_amount REAL NOT NULL DEFAULT 0,
      kassa TEXT NOT NULL DEFAULT '',
      accepted INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT 'Не указано',
      icon TEXT NOT NULL DEFAULT 'cash',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      cash_amount REAL NOT NULL DEFAULT 0,
      kassa TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT 'Не указано',
      icon TEXT NOT NULL DEFAULT 'cash',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      limit_by_debt INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS units_of_measure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES units_of_measure(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES product_types(id) ON DELETE SET NULL,
      show_in_bot INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      photo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SUM',
      linked_list TEXT NOT NULL DEFAULT 'Не указано',
      calc_method TEXT NOT NULL DEFAULT 'Не указано',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  seedIfEmpty(db)
  return db
}

function seedIfEmpty(db: Database.Database) {
  const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count
  if (userCount === 0) {
    const { hash, salt } = hashPassword("admin123")
    db.prepare(
      "INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)",
    ).run(ADMIN_PHONE, "admin", hash, salt)
  } else {
    // Migrate databases created before the login screen switched to phone numbers.
    db.prepare("UPDATE users SET username = ? WHERE username = 'admin'").run(ADMIN_PHONE)
  }

  const clientCount = (db.prepare("SELECT COUNT(*) AS count FROM clients").get() as { count: number }).count
  if (clientCount === 0) {
    const insert = db.prepare(`
      INSERT INTO clients (name, phone, inn, type, zone, zone_agent, agent, deliverer, collector, balance, tab)
      VALUES (@name, @phone, @inn, @type, @zone, @zoneAgent, @agent, @deliverer, @collector, @balance, @tab)
    `)
    const insertAll = db.transaction((rows: typeof seedClients) => {
      for (const client of rows) {
        insert.run({
          name: client.name,
          phone: client.phone ?? "",
          inn: client.inn ?? null,
          type: client.type ?? "",
          zone: client.zone ?? "",
          zoneAgent: client.zoneAgent ?? "Не указано",
          agent: client.agent ?? "Не указано",
          deliverer: client.deliverer ?? "Не указано",
          collector: client.collector ?? "Не указано",
          balance: client.balance ?? null,
          tab: client.tab ?? "all",
        })
      }
    })
    insertAll(seedClients)
  }

  const orderCount = (db.prepare("SELECT COUNT(*) AS count FROM orders").get() as { count: number }).count
  if (orderCount === 0) {
    const insert = db.prepare(`
      INSERT INTO orders (client, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount)
      VALUES (@client, @zone, @type, @product, @created, @delivery, @agent, @amount, @balance, @negative, @status, @discount)
    `)
    const insertAll = db.transaction((rows: typeof seedOrders) => {
      for (const order of rows) {
        insert.run({
          client: order.client,
          zone: order.zone ?? "",
          type: order.type ?? "",
          product: order.product ?? "",
          created: order.created ?? "",
          delivery: order.delivery ?? "",
          agent: order.agent ?? "Admin Ritm",
          amount: order.amount ?? "0 SUM",
          balance: order.balance ?? "0 SUM",
          negative: order.negative ? 1 : 0,
          status: order.status ?? "Есть на складе",
          discount: order.discount ?? null,
        })
      }
    })
    insertAll(seedOrders)
  }

  const currencyCount = (db.prepare("SELECT COUNT(*) AS count FROM currencies").get() as { count: number }).count
  if (currencyCount === 0) {
    const insert = db.prepare(`
      INSERT INTO currencies (name, code, rate, is_base)
      VALUES (@name, @code, @rate, @isBase)
    `)
    const insertAll = db.transaction((rows: typeof seedCurrencies) => {
      for (const currency of rows) {
        insert.run({ name: currency.name, code: currency.code, rate: currency.rate, isBase: currency.isBase ? 1 : 0 })
      }
    })
    insertAll(seedCurrencies)
  }

  const cashboxCount = (db.prepare("SELECT COUNT(*) AS count FROM cashboxes").get() as { count: number }).count
  if (cashboxCount === 0) {
    const insert = db.prepare(`
      INSERT INTO cashboxes (name, currency, cashier, branch, payment_type, vansell, order_number)
      VALUES (@name, @currency, @cashier, @branch, @paymentType, @vansell, @orderNumber)
    `)
    const insertAll = db.transaction((rows: typeof seedCashboxes) => {
      for (const box of rows) {
        insert.run({
          name: box.name,
          currency: box.currency,
          cashier: box.cashier,
          branch: box.branch,
          paymentType: box.paymentType,
          vansell: box.vansell ? 1 : 0,
          orderNumber: box.orderNumber,
        })
      }
    })
    insertAll(seedCashboxes)
  }

  const incomeCategoryCount = (db.prepare("SELECT COUNT(*) AS count FROM income_categories").get() as { count: number }).count
  if (incomeCategoryCount === 0) {
    const insert = db.prepare("INSERT INTO income_categories (name, parameter, other_income) VALUES (@name, @parameter, @otherIncome)")
    const insertAll = db.transaction((rows: typeof seedIncomeCategories) => {
      for (const category of rows) {
        insert.run({ name: category.name, parameter: category.parameter ?? "", otherIncome: category.otherIncome ? 1 : 0 })
      }
    })
    insertAll(seedIncomeCategories)
  }

  const expenseCategoryCount = (db.prepare("SELECT COUNT(*) AS count FROM expense_categories").get() as { count: number }).count
  if (expenseCategoryCount === 0) {
    // Two passes: insert every row with no parent first (source ids may reference
    // a parent that appears later in the array), then wire up parent_id once all
    // rows exist so the self-referencing foreign key never points at a missing row.
    const insert = db.prepare("INSERT INTO expense_categories (name, parameter, direct, exclude_from_pnl) VALUES (@name, @parameter, @direct, @excludeFromPnl)")
    const linkParent = db.prepare("UPDATE expense_categories SET parent_id = ? WHERE id = ?")
    const insertAll = db.transaction((rows: typeof seedExpenseCategories) => {
      const idMap = new Map<number, number>()
      for (const category of rows) {
        const result = insert.run({
          name: category.name,
          parameter: category.parameter ?? "",
          direct: category.direct ? 1 : 0,
          excludeFromPnl: category.excludeFromPnl ? 1 : 0,
        })
        idMap.set(category.id, Number(result.lastInsertRowid))
      }
      for (const category of rows) {
        if (category.parentId === null) continue
        const realId = idMap.get(category.id)
        const realParentId = idMap.get(category.parentId)
        if (realId && realParentId) linkParent.run(realParentId, realId)
      }
    })
    insertAll(seedExpenseCategories)
  }

  const customerPaymentCount = (db.prepare("SELECT COUNT(*) AS count FROM customer_payments").get() as { count: number }).count
  if (customerPaymentCount === 0) {
    const insert = db.prepare(`
      INSERT INTO customer_payments (client, client_code, created_by, paid_at, accepted_at, agent, organization, amount, currency, amount_sum_equivalent, cash_amount, kassa, accepted, comment, icon)
      VALUES (@client, @clientCode, @createdBy, @paidAt, @acceptedAt, @agent, @organization, @amount, @currency, @amountSumEquivalent, @cashAmount, @kassa, @accepted, @comment, @icon)
    `)
    const insertAll = db.transaction((rows: typeof seedCustomerPayments) => {
      for (const payment of rows) {
        insert.run({
          client: payment.client,
          clientCode: payment.clientCode ?? null,
          createdBy: payment.createdBy,
          paidAt: payment.paidAt,
          acceptedAt: payment.acceptedAt,
          agent: payment.agent,
          organization: payment.organization,
          amount: payment.amount,
          currency: payment.currency,
          amountSumEquivalent: payment.amountSumEquivalent ?? null,
          cashAmount: payment.cashAmount,
          kassa: payment.kassa,
          accepted: payment.accepted ? 1 : 0,
          comment: payment.comment,
          icon: payment.icon,
        })
      }
    })
    insertAll(seedCustomerPayments)
  }

  const supplierPaymentCount = (db.prepare("SELECT COUNT(*) AS count FROM supplier_payments").get() as { count: number }).count
  if (supplierPaymentCount === 0) {
    const insert = db.prepare(`
      INSERT INTO supplier_payments (supplier, created_by, paid_at, organization, amount, currency, cash_amount, kassa, comment, icon)
      VALUES (@supplier, @createdBy, @paidAt, @organization, @amount, @currency, @cashAmount, @kassa, @comment, @icon)
    `)
    const insertAll = db.transaction((rows: typeof seedSupplierPayments) => {
      for (const payment of rows) {
        insert.run({
          supplier: payment.supplier,
          createdBy: payment.createdBy,
          paidAt: payment.paidAt,
          organization: payment.organization,
          amount: payment.amount,
          currency: payment.currency,
          cashAmount: payment.cashAmount,
          kassa: payment.kassa,
          comment: payment.comment,
          icon: payment.icon,
        })
      }
    })
    insertAll(seedSupplierPayments)
  }

  const organizationCount = (db.prepare("SELECT COUNT(*) AS count FROM organizations").get() as { count: number }).count
  if (organizationCount === 0) {
    const insert = db.prepare("INSERT INTO organizations (name, limit_by_debt) VALUES (@name, @limitByDebt)")
    const insertAll = db.transaction((rows: typeof seedOrganizations) => {
      for (const organization of rows) {
        insert.run({ name: organization.name, limitByDebt: organization.limitByDebt ? 1 : 0 })
      }
    })
    insertAll(seedOrganizations)
  }

  const unitOfMeasureCount = (db.prepare("SELECT COUNT(*) AS count FROM units_of_measure").get() as { count: number }).count
  if (unitOfMeasureCount === 0) {
    // Two passes: insert every row with no parent first (source ids may reference
    // a parent that appears later in the array), then wire up parent_id once all
    // rows exist so the self-referencing foreign key never points at a missing row.
    const insert = db.prepare("INSERT INTO units_of_measure (name) VALUES (@name)")
    const linkParent = db.prepare("UPDATE units_of_measure SET parent_id = ? WHERE id = ?")
    const insertAll = db.transaction((rows: typeof seedUnitsOfMeasure) => {
      const idMap = new Map<number, number>()
      for (const unit of rows) {
        const result = insert.run({ name: unit.name })
        idMap.set(unit.id, Number(result.lastInsertRowid))
      }
      for (const unit of rows) {
        if (unit.parentId === null) continue
        const realId = idMap.get(unit.id)
        const realParentId = idMap.get(unit.parentId)
        if (realId && realParentId) linkParent.run(realParentId, realId)
      }
    })
    insertAll(seedUnitsOfMeasure)
  }

  const productTypeCount = (db.prepare("SELECT COUNT(*) AS count FROM product_types").get() as { count: number }).count
  if (productTypeCount === 0) {
    // Same two-pass approach as units_of_measure for the self-referencing parent_id.
    const insert = db.prepare("INSERT INTO product_types (name, organization, show_in_bot) VALUES (@name, @organization, @showInBot)")
    const linkParent = db.prepare("UPDATE product_types SET parent_id = ? WHERE id = ?")
    const insertAll = db.transaction((rows: typeof seedProductTypes) => {
      const idMap = new Map<number, number>()
      for (const type of rows) {
        const result = insert.run({ name: type.name, organization: type.organization, showInBot: type.showInBot ? 1 : 0 })
        idMap.set(type.id, Number(result.lastInsertRowid))
      }
      for (const type of rows) {
        if (type.parentId === null) continue
        const realId = idMap.get(type.id)
        const realParentId = idMap.get(type.parentId)
        if (realId && realParentId) linkParent.run(realParentId, realId)
      }
    })
    insertAll(seedProductTypes)
  }

  const brandCount = (db.prepare("SELECT COUNT(*) AS count FROM brands").get() as { count: number }).count
  if (brandCount === 0) {
    const insert = db.prepare("INSERT INTO brands (name, organization, photo_url) VALUES (@name, @organization, @photoUrl)")
    const insertAll = db.transaction((rows: typeof seedBrands) => {
      for (const brand of rows) {
        insert.run({ name: brand.name, organization: brand.organization, photoUrl: brand.photoUrl ?? null })
      }
    })
    insertAll(seedBrands)
  }

  const priceListCount = (db.prepare("SELECT COUNT(*) AS count FROM price_lists").get() as { count: number }).count
  if (priceListCount === 0) {
    const insert = db.prepare(
      "INSERT INTO price_lists (name, currency, linked_list, calc_method) VALUES (@name, @currency, @linkedList, @calcMethod)",
    )
    const insertAll = db.transaction((rows: typeof seedPriceLists) => {
      for (const priceList of rows) {
        insert.run({ name: priceList.name, currency: priceList.currency, linkedList: priceList.linkedList, calcMethod: priceList.calcMethod })
      }
    })
    insertAll(seedPriceLists)
  }
}

export function getDb(): Database.Database {
  if (!globalThis.__linkoDb) {
    globalThis.__linkoDb = createConnection()
  }
  return globalThis.__linkoDb
}
