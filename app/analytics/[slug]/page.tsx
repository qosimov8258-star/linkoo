import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { AnalyticsReportView } from "@/components/analytics/analytics-report-view"
import {
  AgentVisitsView,
  SupervisorAgentVisitsView,
} from "@/components/analytics/agent-visits-view"
import { SystemDistributionView } from "@/components/analytics/system-distribution-view"
import { VisitsByDayView } from "@/components/analytics/visits-by-day-view"
import { PhotoReportReviewView } from "@/components/analytics/photo-report-review-view"
import { AgentWorkingTimeView } from "@/components/analytics/agent-working-time-view"
import { VisitBuilderView } from "@/components/analytics/visit-builder-view"
import { ProductStoreCheckView, StoreCheckView, StoreTimeView } from "@/components/analytics/store-time-view"
import { KpiPerformanceView, KpiTasksView } from "@/components/analytics/kpi-views"
import { SalaryPlanningView } from "@/components/analytics/salary-planning-view"
import { AbcAnalysisView } from "@/components/analytics/abc-analysis-view"
import { SalesByAgentsView } from "@/components/analytics/sales-by-agents-view"
import { SalesByProductsView } from "@/components/analytics/sales-by-products-view"
import { ClientSalesPaymentsView } from "@/components/analytics/client-sales-payments-view"
import { OrderDebtsView } from "@/components/analytics/order-debts-view"
import { ClientDynamicsView } from "@/components/analytics/client-dynamics-view"
import { CoverageAnalysisView } from "@/components/analytics/coverage-analysis-view"
import { AttendanceView } from "@/components/analytics/attendance-view"
import { DuplicateAnalysisView } from "@/components/analytics/duplicate-analysis-view"
import { EquipmentEfficiencyView } from "@/components/analytics/equipment-efficiency-view"
import { ProductionBatchesView } from "@/components/analytics/production-batches-view"
import { ProductionStagesView } from "@/components/analytics/production-stages-view"
import { StockLevelView } from "@/components/analytics/stock-level-view"
import { MaterialReportView } from "@/components/analytics/material-report-view"
import { GoodsMovementView } from "@/components/analytics/goods-movement-dashboard"
import { ReportBuilderView } from "@/components/analytics/report-builder-view"
import { CustomerPaymentsView } from "@/components/analytics/customer-payments-view"
import { SupplierPaymentsView } from "@/components/analytics/supplier-payments-view"
import { ExpectedPaymentsView } from "@/components/analytics/expected-payments-view"
import { SupplierDebtsView } from "@/components/analytics/supplier-debts-view"
import { ContractsView } from "@/components/analytics/contracts-view"
import { CashbackWithdrawalRequestsView } from "@/components/analytics/cashback-withdrawal-requests-view"
import { CurrenciesView } from "@/components/analytics/currencies-view"
import { VansellBalanceView } from "@/components/analytics/vansell-balance-view"
import { ReorderLevelView } from "@/components/analytics/reorder-level-view"
import { RepricingView } from "@/components/analytics/repricing-view"
import { InternalTransfersView } from "@/components/analytics/internal-transfers-view"
import { InventoryManagementView } from "@/components/analytics/inventory-management-view"
import { CashBalanceView } from "@/components/analytics/cash-balance-view"
import { ClientBalanceView } from "@/components/analytics/client-balance-view"
import { SupplierBalanceView } from "@/components/analytics/supplier-balance-view"
import { BranchBalanceView } from "@/components/analytics/branch-balance-view"
import { EmployeeBalanceView } from "@/components/analytics/employee-balance-view"
import { CategoryExpensesView } from "@/components/analytics/category-expenses-view"
import { PayrollExpensesView } from "@/components/analytics/payroll-expenses-view"
import { ExpectedExpensesView } from "@/components/analytics/expected-expenses-view"
import { StoreReconciliationBotView } from "@/components/analytics/store-reconciliation-bot-view"
import { LoyaltyCardView } from "@/components/analytics/loyalty-card-view"
import { DebtLimitsView } from "@/components/analytics/debt-limits-view"
import { QuestionnaireView } from "@/components/analytics/questionnaire-view"
import { SurveyPlanView } from "@/components/analytics/survey-plan-view"
import { TelegramBotPagesView } from "@/components/analytics/telegram-bot-pages-view"
import { RefusalTypesView } from "@/components/analytics/refusal-types-view"
import { ShiftsView } from "@/components/analytics/shifts-view"
import { BranchesView } from "@/components/analytics/branches-view"
import { EmployeesView } from "@/components/analytics/employees-view"
import { PositionsView } from "@/components/analytics/positions-view"
import { AccessRightsView } from "@/components/analytics/access-rights-view"
import { BranchKpiPlansView } from "@/components/analytics/branch-kpi-plans-view"
import { ActivityView } from "@/components/analytics/activity-view"
import { TasksView } from "@/components/analytics/tasks-view"
import { TimeRestrictionsView } from "@/components/analytics/time-restrictions-view"
import { KnowledgeBaseView } from "@/components/analytics/knowledge-base-view"
import { ProductRestrictionsView } from "@/components/analytics/product-restrictions-view"
import { SupplierIncomingsView } from "@/components/analytics/supplier-incomings-view"
import { SupplierReturnsView } from "@/components/analytics/supplier-returns-view"
import { SupplierCategoriesView } from "@/components/analytics/supplier-categories-view"
import { SuppliersView } from "@/components/analytics/suppliers-view"
import { PriceFormationView } from "@/components/analytics/price-formation-view"
import { WriteOffsView } from "@/components/analytics/write-offs-view"
import { WarehousesView } from "@/components/analytics/warehouses-view"
import { ProductsView } from "@/components/analytics/products-view"
import { RawMaterialsView } from "@/components/analytics/raw-materials-view"
import { PriceListsView } from "@/components/analytics/price-lists-view"
import { ProductTypesView } from "@/components/analytics/product-types-view"
import { UnitsOfMeasureView } from "@/components/analytics/units-of-measure-view"
import { BrandsView } from "@/components/analytics/brands-view"
import { CostOfGoodsView } from "@/components/analytics/cost-of-goods-view"
import { OrganizationView } from "@/components/analytics/organization-view"
import { CashboxesView } from "@/components/analytics/cashboxes-view"
import { IncomeCategoriesView } from "@/components/analytics/income-categories-view"
import { ExpenseCategoriesView } from "@/components/analytics/expense-categories-view"
import { AccountDebtsView } from "@/components/analytics/account-debts-view"
import { ManagementBalanceView } from "@/components/analytics/management-balance-view"
import { CashManagementView } from "@/components/analytics/cash-management-view"
import { PriceAnalysisView } from "@/components/analytics/price-analysis-view"
import { InvoiceIncomingsView } from "@/components/analytics/invoice-incomings-view"
import { TransportView } from "@/components/analytics/transport-view"
import { SubscriptionsView } from "@/components/analytics/subscriptions-view"
import { SessionsView } from "@/components/analytics/sessions-view"
import {
  getAnalyticsReport,
  getAnalyticsResource,
} from "@/lib/analytics-catalog"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { getServerT } from "@/lib/i18n/server"

type PageProps = {
  params: Promise<{ slug: string }>
}

// Каждый отчёт рендерится интерактивным клиентским компонентом. generateStaticParams
// раньше делал этот маршрут статически кешируемым, из-за чего под некоторыми
// слагами застревал устаревший HTML от предыдущей реализации компонента.
// Всегда рендерим заново, без статического кеша.
export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const page = getAnalyticsResource(slug) ?? getAnalyticsReport(slug)
  const t = await getServerT()

  if (!page) return { title: `${t("Отчёт не найден")} — Linko` }

  const title = "title" in page ? page.title : page.label
  return {
    title: `${t(title)} — Linko`,
    description: t(page.description),
  }
}

export default async function AnalyticsPage({ params }: PageProps) {
  const { slug } = await params
  const resource = getAnalyticsResource(slug)

  if (resource) {
    const resourceDestinations: Record<string, string> = {
      sales: "/analytics/visits-by-day",
      "warehouse-logistics": "/analytics/system-distribution",
      "finance-cash": "/analytics/kpi-performance",
      production: "/analytics/production-batches",
      general: "/analytics/visits-by-day",
    }
    redirect(resourceDestinations[resource.slug] ?? "/analytics/visits-by-day")
  }

  const report = getAnalyticsReport(slug)
  if (!report || !report.href.startsWith("/analytics/")) notFound()

  if (report.slug === "visits-by-day") {
    return <VisitsByDayView />
  }

  if (report.slug === "agent-visits") {
    return <AgentVisitsView />
  }

  if (report.slug === "system-distribution") {
    return <SystemDistributionView />
  }

  if (report.slug === "supervisor-agent-visits") {
    return <SupervisorAgentVisitsView />
  }

  if (report.slug === "photo-report-review") {
    return <PhotoReportReviewView />
  }

  if (report.slug === "agent-working-time") {
    return <AgentWorkingTimeView />
  }

  if (report.slug === "visit-builder") {
    return <VisitBuilderView />
  }

  if (report.slug === "store-time") {
    return <StoreTimeView />
  }

  if (report.slug === "store-check-completion") {
    return <StoreCheckView />
  }
  if (report.slug === "product-store-check") {
    return <ProductStoreCheckView />
  }

  if (report.slug === "kpi-performance") {
    return <KpiPerformanceView />
  }

  if (report.slug === "kpi-tasks") {
    return <KpiTasksView />
  }

  if (report.slug === "salary-planning") {
    return <SalaryPlanningView />
  }

  if (report.slug === "abc-analysis") {
    return <AbcAnalysisView />
  }

  if (report.slug === "sales-by-agents") {
    return <SalesByAgentsView />
  }
  if (report.slug === "product-profit" || report.slug === "sales-by-products") {
    return <SalesByProductsView />
  }
  if (report.slug === "client-sales-payments") {
    return <ClientSalesPaymentsView />
  }

  if (report.slug === "order-debts") {
    return <OrderDebtsView />
  }
  if (report.slug === "client-dynamics") {
    return <ClientDynamicsView />
  }
  if (report.slug === "sales-builder") {
    return <VisitBuilderView variant="sales" />
  }
  if (report.slug === "coverage-analysis") {
    return <CoverageAnalysisView />
  }
  if (report.slug === "attendance" || report.slug === "work-attendance") {
    return <AttendanceView />
  }
  if (report.slug === "duplicate-analysis") {
    return <DuplicateAnalysisView />
  }
  if (report.slug === "equipment-efficiency") {
    return <EquipmentEfficiencyView />
  }
  if (report.slug === "production-batches") {
    return <ProductionBatchesView />
  }
  if (report.slug === "production-stages") {
    return <ProductionStagesView />
  }
  if (report.slug === "stock-level") {
    return <StockLevelView />
  }
  if (report.slug === "stock-by-date" || report.slug === "material-report" || report.slug === "goods-movement") {
    return <MaterialReportView />
  }

  if (report.slug === "receipt-transfer-plan") {
    return <GoodsMovementView />
  }

  if (report.slug === "current-stock-report-builder") {
    return <ReportBuilderView />
  }

  if (report.slug === "customer-payments") {
    return <CustomerPaymentsView />
  }

  if (report.slug === "supplier-payments") {
    return <SupplierPaymentsView />
  }

  if (report.slug === "expected-payments") {
    return <ExpectedPaymentsView />
  }

  if (report.slug === "supplier-debts") {
    return <SupplierDebtsView />
  }

  if (report.slug === "contracts") {
    return <ContractsView />
  }

  if (report.slug === "cashback-withdrawal-requests") {
    return <CashbackWithdrawalRequestsView />
  }

  if (report.slug === "currencies") {
    return <CatalogPageLayout><CurrenciesView embedded /></CatalogPageLayout>
  }

  if (report.slug === "vansell-balance") {
    return <VansellBalanceView />
  }

  if (report.slug === "reorder-level") {
    return <ReorderLevelView />
  }

  if (report.slug === "repricing") {
    return <RepricingView />
  }

  if (report.slug === "internal-transfers") {
    return <InternalTransfersView />
  }

  if (report.slug === "inventory-management") {
    return <InventoryManagementView />
  }

  if (report.slug === "cash-balance") {
    return <CashBalanceView />
  }

  if (report.slug === "client-balance") {
    return <ClientBalanceView />
  }

  if (report.slug === "supplier-balance") {
    return <SupplierBalanceView />
  }

  if (report.slug === "branch-balance") {
    return <BranchBalanceView />
  }

  if (report.slug === "employee-balance") {
    return <EmployeeBalanceView />
  }

  if (report.slug === "category-expenses") {
    return <CategoryExpensesView />
  }

  if (report.slug === "payroll-expenses") {
    return <PayrollExpensesView />
  }

  if (report.slug === "expected-expenses") {
    return <ExpectedExpensesView />
  }

  if (report.slug === "store-reconciliation-bot") {
    return <StoreReconciliationBotView />
  }

  if (report.slug === "account-reconciliation") {
    return <StoreReconciliationBotView variant="account" />
  }

  if (report.slug === "loyalty-card") {
    return <LoyaltyCardView />
  }

  if (report.slug === "debt-limits") {
    return <DebtLimitsView />
  }

  if (report.slug === "surveys") {
    return <QuestionnaireView />
  }

  if (report.slug === "survey-plans") {
    return <SurveyPlanView />
  }

  if (report.slug === "telegram-pages") {
    return <TelegramBotPagesView />
  }

  if (report.slug === "refusal-types") {
    return <RefusalTypesView />
  }

  if (report.slug === "shifts") {
    return <CatalogPageLayout><ShiftsView embedded /></CatalogPageLayout>
  }

  if (report.slug === "branches") {
    return <BranchesView />
  }

  if (report.slug === "employees") {
    return <CatalogPageLayout><EmployeesView /></CatalogPageLayout>
  }

  if (report.slug === "positions") {
    return <CatalogPageLayout><PositionsView embedded /></CatalogPageLayout>
  }

  if (report.slug === "access-rights") {
    return <CatalogPageLayout><AccessRightsView /></CatalogPageLayout>
  }

  if (report.slug === "branch-kpi-plans") {
    return <BranchKpiPlansView />
  }

  if (report.slug === "activity") {
    return <ActivityView />
  }

  if (report.slug === "tasks") {
    return <TasksView />
  }

  if (report.slug === "time-restrictions") {
    return <TimeRestrictionsView />
  }

  if (report.slug === "knowledge-base") {
    return <KnowledgeBaseView />
  }

  if (report.slug === "product-restrictions") {
    return <ProductRestrictionsView />
  }

  if (report.slug === "supplier-incomings") {
    return <SupplierIncomingsView />
  }

  if (report.slug === "supplier-returns") {
    return <SupplierReturnsView />
  }

  if (report.slug === "supplier-categories") {
    return <SupplierCategoriesView />
  }

  if (report.slug === "suppliers") {
    return <SuppliersView />
  }

  if (report.slug === "price-formation") {
    return <PriceFormationView />
  }

  if (report.slug === "write-offs") {
    return <WriteOffsView />
  }

  if (report.slug === "warehouses") {
    return <WarehousesView />
  }

  if (report.slug === "products") {
    return <ProductsView />
  }

  if (report.slug === "raw-materials") {
    return <RawMaterialsView />
  }

  if (report.slug === "price-lists") {
    return <PriceListsView />
  }

  if (report.slug === "product-types") {
    return <CatalogPageLayout><ProductTypesView embedded /></CatalogPageLayout>
  }

  if (report.slug === "units-of-measure") {
    return <CatalogPageLayout><UnitsOfMeasureView embedded /></CatalogPageLayout>
  }

  if (report.slug === "brands") {
    return <CatalogPageLayout><BrandsView embedded /></CatalogPageLayout>
  }

  if (report.slug === "cost-of-goods") {
    return <CostOfGoodsView />
  }

  if (report.slug === "organization") {
    return <OrganizationView />
  }

  if (report.slug === "cashboxes") {
    return <CatalogPageLayout><CashboxesView embedded /></CatalogPageLayout>
  }

  if (report.slug === "income-categories") {
    return <CatalogPageLayout><IncomeCategoriesView embedded /></CatalogPageLayout>
  }

  if (report.slug === "expense-categories") {
    return <CatalogPageLayout><ExpenseCategoriesView embedded /></CatalogPageLayout>
  }

  if (report.slug === "account-debts") {
    return <AccountDebtsView />
  }

  if (report.slug === "management-balance") {
    return <ManagementBalanceView />
  }

  if (report.slug === "cash-management") {
    return <CashManagementView />
  }

  if (report.slug === "price-analysis") {
    return <PriceAnalysisView />
  }

  if (report.slug === "invoice-incomings") {
    return <InvoiceIncomingsView />
  }

  if (report.slug === "transport") {
    return <CatalogPageLayout><TransportView embedded /></CatalogPageLayout>
  }

  if (report.slug === "subscriptions") {
    return <CatalogPageLayout><SubscriptionsView embedded /></CatalogPageLayout>
  }

  if (report.slug === "sessions") {
    return <CatalogPageLayout><SessionsView embedded /></CatalogPageLayout>
  }

  return <AnalyticsReportView report={report} />
}

