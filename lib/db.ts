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
import { seedProducts } from "@/components/analytics/products-data"
import { seedRawMaterials } from "@/components/analytics/raw-materials-data"
import { seedWarehouses } from "@/components/analytics/warehouses-data"
import { seedWriteOffs } from "@/components/analytics/write-offs-data"
import { seedTransfers } from "@/components/analytics/internal-transfers-data"
import { seedSupplierCategories } from "@/components/analytics/supplier-categories-data"
import { seedSuppliers } from "@/components/analytics/suppliers-data"
import { seedIncomings } from "@/components/analytics/supplier-incomings-data"
import { seedReturns } from "@/components/analytics/supplier-returns-data"
import { hashPassword } from "@/lib/auth"

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "app.db")

// Credentials for the seeded demo admin account, matching the Логин/Пароль
// fields on the login screen.
export const ADMIN_USERNAME = "admin"
export const ADMIN_PASSWORD = "123"
// Legacy seed username (phone-number form) from before the login screen
// switched to Сервер/Логин/Пароль fields — used to migrate existing DBs.
const LEGACY_ADMIN_PHONE = "998901234567"

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

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT 'не установлен',
      article TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      sub_unit TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      has_photo INTEGER NOT NULL DEFAULT 0,
      can_sell INTEGER NOT NULL DEFAULT 1,
      is_inventory INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      only_mml INTEGER NOT NULL DEFAULT 0,
      perfect_store INTEGER NOT NULL DEFAULT 0,
      group_only INTEGER NOT NULL DEFAULT 0,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      manual_discount INTEGER NOT NULL DEFAULT 0,
      hide_from_agent INTEGER NOT NULL DEFAULT 0,
      track_series INTEGER NOT NULL DEFAULT 0,
      subcategory TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT 'No brand',
      min_stock TEXT NOT NULL DEFAULT '0 шт.',
      description TEXT NOT NULL DEFAULT 'Не указано',
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      integration_code TEXT NOT NULL DEFAULT '',
      volume TEXT NOT NULL DEFAULT 'Не указано м³.',
      weight TEXT NOT NULL DEFAULT '0 кг.',
      net_weight TEXT NOT NULL DEFAULT '0',
      color TEXT NOT NULL DEFAULT 'Не указано',
      price_lists TEXT NOT NULL DEFAULT '[]',
      cost REAL NOT NULL DEFAULT 0,
      price_min REAL NOT NULL DEFAULT 0,
      price_max REAL NOT NULL DEFAULT 0,
      price_updated_date TEXT NOT NULL DEFAULT 'Не установлена',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT 'не установлен',
      article TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      sub_unit TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      brand TEXT NOT NULL DEFAULT 'No brand',
      min_stock TEXT NOT NULL DEFAULT '0',
      color TEXT NOT NULL DEFAULT 'Не указано',
      integration_code TEXT NOT NULL DEFAULT '',
      mass TEXT NOT NULL DEFAULT '0',
      net_weight TEXT NOT NULL DEFAULT '0',
      volume TEXT NOT NULL DEFAULT 'Не указано',
      description TEXT NOT NULL DEFAULT 'Не указано',
      can_sell INTEGER NOT NULL DEFAULT 1,
      only_mml INTEGER NOT NULL DEFAULT 0,
      show_as_inventory INTEGER NOT NULL DEFAULT 0,
      group_only INTEGER NOT NULL DEFAULT 0,
      show_in_bot INTEGER NOT NULL DEFAULT 1,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      marked_product INTEGER NOT NULL DEFAULT 0,
      price_list TEXT NOT NULL DEFAULT '',
      cash_price TEXT NOT NULL DEFAULT '0',
      non_cash_price TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repricings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at_label TEXT NOT NULL DEFAULT '',
      price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      status TEXT NOT NULL DEFAULT 'проведен',
      user TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      online INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS write_offs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator TEXT NOT NULL DEFAULT 'Admin Ritm',
      warehouse TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'закрыт',
      comment TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS internal_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_warehouse TEXT NOT NULL DEFAULT '',
      to_warehouse TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at_label TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'потвержден',
      price_list TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      transport_number TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT 'Не указано',
      organization TEXT NOT NULL DEFAULT 'Не указано',
      contacts TEXT NOT NULL DEFAULT '[]',
      products TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_incomings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT 'Банковский счет',
      contract_number TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'принят',
      invoice_number TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT 'Не указан',
      email TEXT NOT NULL DEFAULT 'Не указан',
      initiator TEXT NOT NULL DEFAULT 'Admin Ritm',
      paid REAL NOT NULL DEFAULT 0,
      time TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_whom TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      date TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'завершен',
      organization TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'SUM',
      payment_type TEXT NOT NULL DEFAULT '',
      price_list TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      transfer_time TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Additive migration for dev databases created before repricings switched
  // from free-text product/price_list columns to real nullable foreign keys.
  ensureColumn(db, "repricings", "price_list_id", "INTEGER REFERENCES price_lists(id) ON DELETE SET NULL")
  ensureColumn(db, "repricings", "product_id", "INTEGER REFERENCES products(id) ON DELETE SET NULL")

  // raw_materials.supplier started as free text (suppliers didn't exist yet);
  // add a nullable FK alongside it once suppliers does. seedIfEmpty backfills
  // supplier_id by matching the existing text against suppliers.name.
  ensureColumn(db, "raw_materials", "supplier_id", "INTEGER REFERENCES suppliers(id) ON DELETE SET NULL")

  seedIfEmpty(db)
  return db
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

function seedIfEmpty(db: Database.Database) {
  const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count
  if (userCount === 0) {
    const { hash, salt } = hashPassword(ADMIN_PASSWORD)
    db.prepare(
      "INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)",
    ).run(ADMIN_USERNAME, "admin", hash, salt)
  } else {
    // Migrate DBs seeded before the login screen switched to Сервер/Логин/Пароль
    // fields (old seeds used a phone-number username with a different password)
    // so the "admin" / "123" demo login always works.
    const legacy = db
      .prepare("SELECT id FROM users WHERE username IN (?, ?)")
      .get(ADMIN_USERNAME, LEGACY_ADMIN_PHONE) as { id: number } | undefined
    const { hash, salt } = hashPassword(ADMIN_PASSWORD)
    if (legacy) {
      db.prepare("UPDATE users SET username = ?, password_hash = ?, password_salt = ? WHERE id = ?").run(
        ADMIN_USERNAME,
        hash,
        salt,
        legacy.id,
      )
    } else {
      db.prepare(
        "INSERT INTO users (username, display_name, password_hash, password_salt) VALUES (?, ?, ?, ?)",
      ).run(ADMIN_USERNAME, "admin", hash, salt)
    }
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

  const productCount = (db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number }).count
  if (productCount === 0) {
    const insert = db.prepare(`
      INSERT INTO products (
        name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number,
        has_photo, can_sell, is_inventory, deleted, only_mml, perfect_store, group_only, track_expiry,
        manual_discount, hide_from_agent, track_series, subcategory, brand, min_stock, description, supplier,
        integration_code, volume, weight, net_weight, color, price_lists, cost, price_min, price_max, price_updated_date
      ) VALUES (
        @name, @fullName, @barcode, @article, @type, @organization, @unit, @subUnit, @createdDate, @orderNumber,
        @hasPhoto, @canSell, @isInventory, @deleted, @onlyMml, @perfectStore, @groupOnly, @trackExpiry,
        @manualDiscount, @hideFromAgent, @trackSeries, @subcategory, @brand, @minStock, @description, @supplier,
        @integrationCode, @volume, @weight, @netWeight, @color, @priceLists, @cost, @priceMin, @priceMax, @priceUpdatedDate
      )
    `)
    const insertAll = db.transaction((rows: typeof seedProducts) => {
      for (const product of rows) {
        insert.run({
          name: product.name,
          fullName: product.fullName,
          barcode: product.barcode,
          article: product.article,
          type: product.type,
          organization: product.organization,
          unit: product.unit,
          subUnit: product.subUnit,
          createdDate: product.createdDate,
          orderNumber: product.orderNumber,
          hasPhoto: product.hasPhoto ? 1 : 0,
          canSell: product.canSell ? 1 : 0,
          isInventory: product.isInventory ? 1 : 0,
          deleted: product.deleted ? 1 : 0,
          onlyMml: product.onlyMml ? 1 : 0,
          perfectStore: product.perfectStore ? 1 : 0,
          groupOnly: product.groupOnly ? 1 : 0,
          trackExpiry: product.trackExpiry ? 1 : 0,
          manualDiscount: product.manualDiscount ? 1 : 0,
          hideFromAgent: product.hideFromAgent ? 1 : 0,
          trackSeries: product.trackSeries ? 1 : 0,
          subcategory: product.subcategory,
          brand: product.brand,
          minStock: product.minStock,
          description: product.description,
          supplier: product.supplier,
          integrationCode: product.integrationCode,
          volume: product.volume,
          weight: product.weight,
          netWeight: product.netWeight,
          color: product.color,
          priceLists: JSON.stringify(product.priceLists),
          cost: product.cost,
          priceMin: product.priceMin,
          priceMax: product.priceMax,
          priceUpdatedDate: product.priceUpdatedDate,
        })
      }
    })
    insertAll(seedProducts)
  }

  const rawMaterialCount = (db.prepare("SELECT COUNT(*) AS count FROM raw_materials").get() as { count: number }).count
  if (rawMaterialCount === 0) {
    const insert = db.prepare(`
      INSERT INTO raw_materials (
        name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number,
        supplier, brand, min_stock, color, integration_code, mass, net_weight, volume, description, can_sell,
        only_mml, show_as_inventory, group_only, show_in_bot, track_expiry, marked_product, price_list, cash_price, non_cash_price
      ) VALUES (
        @name, @fullName, @barcode, @article, @type, @organization, @unit, @subUnit, @createdDate, @orderNumber,
        @supplier, @brand, @minStock, @color, @integrationCode, @mass, @netWeight, @volume, @description, @canSell,
        @onlyMml, @showAsInventory, @groupOnly, @showInBot, @trackExpiry, @markedProduct, @priceList, @cashPrice, @nonCashPrice
      )
    `)
    const insertAll = db.transaction((rows: typeof seedRawMaterials) => {
      for (const material of rows) {
        insert.run({
          name: material.name,
          fullName: material.fullName,
          barcode: material.barcode,
          article: material.article,
          type: material.type,
          organization: material.organization,
          unit: material.unit,
          subUnit: material.subUnit,
          createdDate: material.createdDate,
          orderNumber: material.orderNumber,
          supplier: material.supplier,
          brand: material.brand,
          minStock: material.minStock,
          color: material.color,
          integrationCode: material.integrationCode,
          mass: material.mass,
          netWeight: material.netWeight,
          volume: material.volume,
          description: material.description,
          canSell: material.canSell ? 1 : 0,
          onlyMml: material.onlyMml ? 1 : 0,
          showAsInventory: material.showAsInventory ? 1 : 0,
          groupOnly: material.groupOnly ? 1 : 0,
          showInBot: material.showInBot ? 1 : 0,
          trackExpiry: material.trackExpiry ? 1 : 0,
          markedProduct: material.markedProduct ? 1 : 0,
          priceList: material.priceList,
          cashPrice: material.cashPrice,
          nonCashPrice: material.nonCashPrice,
        })
      }
    })
    insertAll(seedRawMaterials)
  }

  const repricingCount = (db.prepare("SELECT COUNT(*) AS count FROM repricings").get() as { count: number }).count
  if (repricingCount === 0) {
    // Seed against the products/price_lists rows that were just inserted above,
    // so these demo revaluation runs resolve to real, joinable rows instead of
    // free-floating text.
    const productIds = (db.prepare("SELECT id FROM products ORDER BY id ASC").all() as { id: number }[]).map((row) => row.id)
    const priceListIds = (db.prepare("SELECT id FROM price_lists ORDER BY id ASC").all() as { id: number }[]).map((row) => row.id)
    const users = ["Admin Ritm", "Samandar Abdurahmonov", "Temur Raupov"]
    const seededRandom = (seed: number) => {
      const value = Math.sin(seed) * 10000
      return value - Math.floor(value)
    }
    const insert = db.prepare(`
      INSERT INTO repricings (created_by, created_at_label, price_list_id, product_id, amount, currency, status, user)
      VALUES (@createdBy, @createdAtLabel, @priceListId, @productId, @amount, @currency, @status, @user)
    `)
    const ROWS = 20
    const insertAll = db.transaction(() => {
      if (productIds.length === 0 || priceListIds.length === 0) return
      for (let index = 0; index < ROWS; index += 1) {
        const id = ROWS - index
        const currency = id % 11 === 0 ? "USD" : id % 7 === 0 ? "Euro" : "SUM"
        const magnitude = Math.round(seededRandom(id) * 120000000)
        const sign = id % 5 === 0 ? 0 : id % 3 === 0 ? -1 : 1
        const day = 1 + (id % 28)
        const month = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."][id % 12]
        const monthFull = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"][id % 12]
        const year = id > 15 ? 2026 : id > 7 ? 2025 : 2024
        const dateLabel = month === "мая" || month === "июня" || month === "июля"
          ? `${String(day).padStart(2, "0")} ${monthFull.toLocaleLowerCase("ru")} ${year}`
          : `${String(day).padStart(2, "0")} ${month} ${year}`
        insert.run({
          createdBy: "Admin Ritm",
          createdAtLabel: dateLabel,
          priceListId: priceListIds[id % priceListIds.length],
          productId: productIds[id % productIds.length],
          amount: sign * magnitude,
          currency,
          status: "проведен",
          user: users[id % users.length],
        })
      }
    })
    insertAll()
  }

  const warehouseCount = (db.prepare("SELECT COUNT(*) AS count FROM warehouses").get() as { count: number }).count
  if (warehouseCount === 0) {
    const insert = db.prepare(`
      INSERT INTO warehouses (name, address, branch, manager, created_date, online, active)
      VALUES (@name, @address, @branch, @manager, @createdDate, @online, @active)
    `)
    const insertAll = db.transaction((rows: typeof seedWarehouses) => {
      for (const row of rows) {
        insert.run({
          name: row.name,
          address: row.address,
          branch: row.branch,
          manager: row.manager,
          createdDate: row.createdDate,
          online: row.online ? 1 : 0,
          active: row.active ? 1 : 0,
        })
      }
    })
    insertAll(seedWarehouses)
  }

  const writeOffCount = (db.prepare("SELECT COUNT(*) AS count FROM write_offs").get() as { count: number }).count
  if (writeOffCount === 0) {
    const insert = db.prepare(`
      INSERT INTO write_offs (creator, warehouse, date, status, comment, reason, items)
      VALUES (@creator, @warehouse, @date, @status, @comment, @reason, @items)
    `)
    const insertAll = db.transaction((rows: typeof seedWriteOffs) => {
      for (const row of rows) {
        insert.run({
          creator: row.creator,
          warehouse: row.warehouse,
          date: row.date,
          status: row.status,
          comment: row.comment,
          reason: row.reason,
          items: JSON.stringify(row.items),
        })
      }
    })
    insertAll(seedWriteOffs)
  }

  const transferCount = (db.prepare("SELECT COUNT(*) AS count FROM internal_transfers").get() as { count: number }).count
  if (transferCount === 0) {
    const insert = db.prepare(`
      INSERT INTO internal_transfers (
        from_warehouse, to_warehouse, created_by, created_at_label, delivered_at, amount, weight,
        status, price_list, organization, invoice_number, transport_number, driver, comment, items
      ) VALUES (
        @fromWarehouse, @toWarehouse, @createdBy, @createdAtLabel, @deliveredAt, @amount, @weight,
        @status, @priceList, @organization, @invoiceNumber, @transportNumber, @driver, @comment, @items
      )
    `)
    const insertAll = db.transaction((rows: typeof seedTransfers) => {
      for (const row of rows) {
        insert.run({
          fromWarehouse: row.fromWarehouse,
          toWarehouse: row.toWarehouse,
          createdBy: row.createdBy,
          createdAtLabel: row.createdAt,
          deliveredAt: row.deliveredAt,
          amount: row.amount,
          weight: row.weight,
          status: row.status,
          priceList: row.priceList,
          organization: row.organization,
          invoiceNumber: row.invoiceNumber,
          transportNumber: row.transportNumber,
          driver: row.driver,
          comment: row.comment,
          items: JSON.stringify(row.items),
        })
      }
    })
    insertAll(seedTransfers)
  }

  const supplierCategoryCount = (db.prepare("SELECT COUNT(*) AS count FROM supplier_categories").get() as { count: number }).count
  if (supplierCategoryCount === 0) {
    const insert = db.prepare("INSERT INTO supplier_categories (name) VALUES (@name)")
    const insertAll = db.transaction((rows: typeof seedSupplierCategories) => {
      for (const row of rows) insert.run({ name: row.name })
    })
    insertAll(seedSupplierCategories)
  }

  const supplierCount = (db.prepare("SELECT COUNT(*) AS count FROM suppliers").get() as { count: number }).count
  if (supplierCount === 0) {
    const insert = db.prepare(`
      INSERT INTO suppliers (name, category, created_date, address, branch, organization, contacts, products)
      VALUES (@name, @category, @createdDate, @address, @branch, @organization, @contacts, @products)
    `)
    const insertAll = db.transaction((rows: typeof seedSuppliers) => {
      for (const row of rows) {
        insert.run({
          name: row.name,
          category: row.category,
          createdDate: row.createdDate,
          address: row.address,
          branch: row.branch,
          organization: row.organization,
          contacts: JSON.stringify(row.contacts),
          products: JSON.stringify(row.products),
        })
      }
    })
    insertAll(seedSuppliers)
  }

  // Backfill raw_materials.supplier_id from the free-text supplier column now
  // that suppliers exist, matching by exact name (case-insensitive).
  const unlinkedRawMaterials = db
    .prepare("SELECT id, supplier FROM raw_materials WHERE supplier_id IS NULL AND supplier IS NOT NULL AND supplier != ''")
    .all() as { id: number; supplier: string }[]
  if (unlinkedRawMaterials.length > 0) {
    const findSupplier = db.prepare("SELECT id FROM suppliers WHERE lower(name) = lower(?) LIMIT 1")
    const linkSupplier = db.prepare("UPDATE raw_materials SET supplier_id = ? WHERE id = ?")
    const linkAll = db.transaction((rows: typeof unlinkedRawMaterials) => {
      for (const row of rows) {
        const match = findSupplier.get(row.supplier) as { id: number } | undefined
        if (match) linkSupplier.run(match.id, row.id)
      }
    })
    linkAll(unlinkedRawMaterials)
  }

  const incomingCount = (db.prepare("SELECT COUNT(*) AS count FROM supplier_incomings").get() as { count: number }).count
  if (incomingCount === 0) {
    const insert = db.prepare(`
      INSERT INTO supplier_incomings (
        supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number,
        organization, branch, phone, email, initiator, paid, time, comment, items
      ) VALUES (
        @supplier, @warehouse, @date, @paymentType, @contractNumber, @amount, @status, @invoiceNumber,
        @organization, @branch, @phone, @email, @initiator, @paid, @time, @comment, @items
      )
    `)
    const insertAll = db.transaction((rows: typeof seedIncomings) => {
      for (const row of rows) {
        insert.run({
          supplier: row.supplier,
          warehouse: row.warehouse,
          date: row.date,
          paymentType: row.paymentType,
          contractNumber: row.contractNumber,
          amount: row.amount,
          status: row.status,
          invoiceNumber: row.invoiceNumber,
          organization: row.organization,
          branch: row.branch,
          phone: row.phone,
          email: row.email,
          initiator: row.initiator,
          paid: row.paid,
          time: row.time,
          comment: row.comment,
          items: JSON.stringify(row.items),
        })
      }
    })
    insertAll(seedIncomings)
  }

  const returnCount = (db.prepare("SELECT COUNT(*) AS count FROM supplier_returns").get() as { count: number }).count
  if (returnCount === 0) {
    const insert = db.prepare(`
      INSERT INTO supplier_returns (
        from_whom, warehouse, added_by, date, time, amount, status, organization, currency,
        payment_type, price_list, branch, transfer_time, reason, items
      ) VALUES (
        @fromWhom, @warehouse, @addedBy, @date, @time, @amount, @status, @organization, @currency,
        @paymentType, @priceList, @branch, @transferTime, @reason, @items
      )
    `)
    const insertAll = db.transaction((rows: typeof seedReturns) => {
      for (const row of rows) {
        insert.run({
          fromWhom: row.fromWhom,
          warehouse: row.warehouse,
          addedBy: row.addedBy,
          date: row.date,
          time: row.time,
          amount: row.amount,
          status: row.status,
          organization: row.organization,
          currency: row.currency,
          paymentType: row.paymentType,
          priceList: row.priceList,
          branch: row.branch,
          transferTime: row.transferTime,
          reason: row.reason,
          items: JSON.stringify(row.items),
        })
      }
    })
    insertAll(seedReturns)
  }
}

export function getDb(): Database.Database {
  if (!globalThis.__linkoDb) {
    globalThis.__linkoDb = createConnection()
  }
  return globalThis.__linkoDb
}
