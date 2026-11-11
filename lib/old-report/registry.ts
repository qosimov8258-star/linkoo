import "server-only"

import type { AnyModel } from "./context"
import { acceptedClientTransactionModel, clientTransactionModel, salaryTransactionModel, transactionModel } from "./models/finance"
import { rejectionModel, todayPlansModel, visitModel } from "./models/field"
import { marketModel } from "./models/markets"
import { attendanceModel, debtSeparationModel, merchReportModel, orderLogsModel, subscriptionModel, userModel } from "./models/misc"
import { acceptedProductModel, deliveryProductModel, orderProductModel } from "./models/order-lines"
import { orderModel } from "./models/orders"
import { orderReturnProductModel, returnProductByStockModel } from "./models/returns"
import { orderAndReturnDeliveryModel, orderAndReturnModel } from "./models/sales-union"
import { stockTransactionModel, stockTransactionPartyModel } from "./models/stock"
import { supplyProductModel, writeoffModel } from "./models/stock-docs"
import {
  manufactureReturnModel,
  manufactureReturnPartyDateModel,
  manufactureWriteoffModel,
  manufactureWriteoffPartyDateModel,
  productBalancesModel,
  productSeriesBalancesModel,
  stockTransferProductModel,
  supplyExpenseModel,
} from "./models/stock-more"

// The models of the catalog (lib/old-report/catalog.ts) this app builds reports for, by the catalog's model key.
// A model without an entry is not offered by the builder.
export const OLD_REPORT_MODELS: Record<string, AnyModel> = {
  order_and_return_delivery: orderAndReturnDeliveryModel as unknown as AnyModel,
  order_and_return: orderAndReturnModel as unknown as AnyModel,
  order_product: orderProductModel as unknown as AnyModel,
  delivery_product: deliveryProductModel as unknown as AnyModel,
  accepted_product: acceptedProductModel as unknown as AnyModel,
  order_return_product: orderReturnProductModel as unknown as AnyModel,
  return_product_by_stock: returnProductByStockModel as unknown as AnyModel,
  rejection: rejectionModel as unknown as AnyModel,
  order: orderModel as unknown as AnyModel,
  today_plans: todayPlansModel as unknown as AnyModel,
  stock_transaction: stockTransactionModel as unknown as AnyModel,
  stock_transaction_party: stockTransactionPartyModel as unknown as AnyModel,
  market: marketModel as unknown as AnyModel,
  supply_product: supplyProductModel as unknown as AnyModel,
  writeoff: writeoffModel as unknown as AnyModel,
  visit: visitModel as unknown as AnyModel,
  client_transaction: clientTransactionModel as unknown as AnyModel,
  accepted_client_transaction: acceptedClientTransactionModel as unknown as AnyModel,
  transaction: transactionModel as unknown as AnyModel,
  salary_transaction: salaryTransactionModel as unknown as AnyModel,
  product_balances: productBalancesModel as unknown as AnyModel,
  product_series_balances: productSeriesBalancesModel as unknown as AnyModel,
  manufacture_writeoff: manufactureWriteoffModel as unknown as AnyModel,
  manufacture_return: manufactureReturnModel as unknown as AnyModel,
  manufacture_writeoff_party_date: manufactureWriteoffPartyDateModel as unknown as AnyModel,
  manufacture_return_party_date: manufactureReturnPartyDateModel as unknown as AnyModel,
  stock_transfer_product: stockTransferProductModel as unknown as AnyModel,
  supply_expense: supplyExpenseModel as unknown as AnyModel,
  order_logs: orderLogsModel as unknown as AnyModel,
  debt_separation: debtSeparationModel as unknown as AnyModel,
  user: userModel as unknown as AnyModel,
  attendance: attendanceModel as unknown as AnyModel,
  merch_report: merchReportModel as unknown as AnyModel,
  subscription: subscriptionModel as unknown as AnyModel,
}
