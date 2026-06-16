import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { investmentTabs, spendingTabs } from './config/navigation';
import { useAuth } from './features/auth/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { AppShell } from './layouts/AppShell';
import { TabbedSectionLayout } from './layouts/TabbedSectionLayout';
import { InvestmentsFxPanel } from './features/investments/InvestmentsFxPanel';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const IncomePage = lazy(() => import('./pages/IncomePage').then((module) => ({ default: module.IncomePage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((module) => ({ default: module.ExpensesPage })));
const CreditCardsPage = lazy(() => import('./pages/CreditCardsPage').then((module) => ({ default: module.CreditCardsPage })));
const InvestmentsPage = lazy(() => import('./pages/InvestmentsPage').then((module) => ({ default: module.InvestmentsPage })));
const StockBuysPage = lazy(() => import('./pages/StockBuysPage').then((module) => ({ default: module.StockBuysPage })));
const StockSellsPage = lazy(() => import('./pages/StockSellsPage').then((module) => ({ default: module.StockSellsPage })));
const StockHoldingsPage = lazy(() => import('./pages/StockHoldingsPage').then((module) => ({ default: module.StockHoldingsPage })));
const DividendsPage = lazy(() => import('./pages/DividendsPage').then((module) => ({ default: module.DividendsPage })));
const CatalogsPage = lazy(() => import('./pages/CatalogsPage').then((module) => ({ default: module.CatalogsPage })));
const TicketsPage = lazy(() => import('./pages/TicketsPage').then((module) => ({ default: module.TicketsPage })));
const TicketScanPage = lazy(() => import('./pages/TicketScanPage').then((module) => ({ default: module.TicketScanPage })));

function RouteFallback() {
  return (
    <div className="page">
      <section className="card">
        <p className="card__text">Cargando módulo...</p>
      </section>
    </div>
  );
}

function LegacySectionRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();

  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export default function App() {
  const { isConfigured, isLoading, session } = useAuth();

  if (!isConfigured) {
    return <AuthPage mode="config-error" />;
  }

  if (isLoading) {
    return <AuthPage mode="loading" />;
  }

  if (!session) {
    return <AuthPage mode="auth" />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="/dashboard/:dashboardTab"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="/income"
          element={
            <Suspense fallback={<RouteFallback />}>
              <IncomePage />
            </Suspense>
          }
        />
        <Route
          path="/investments"
          element={<TabbedSectionLayout tabs={investmentTabs} ariaLabel="Inversiones" headerContent={<InvestmentsFxPanel />} />}
        >
          <Route
            index
            element={
              <Suspense fallback={<RouteFallback />}>
                <InvestmentsPage />
              </Suspense>
            }
          />
          <Route
            path="buys"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StockBuysPage />
              </Suspense>
            }
          />
          <Route
            path="sells"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StockSellsPage />
              </Suspense>
            }
          />
          <Route
            path="holdings"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StockHoldingsPage />
              </Suspense>
            }
          />
          <Route
            path="dividends"
            element={
              <Suspense fallback={<RouteFallback />}>
                <DividendsPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/spending"
          element={<TabbedSectionLayout tabs={spendingTabs} ariaLabel="Gastos" />}
        >
          <Route
            index
            element={
              <Suspense fallback={<RouteFallback />}>
                <ExpensesPage />
              </Suspense>
            }
          />
          <Route
            path="tickets"
            element={
              <Suspense fallback={<RouteFallback />}>
                <TicketsPage />
              </Suspense>
            }
          />
          <Route
            path="scan"
            element={
              <Suspense fallback={<RouteFallback />}>
                <TicketScanPage />
              </Suspense>
            }
          />
          <Route
            path="credit-cards"
            element={
              <Suspense fallback={<RouteFallback />}>
                <CreditCardsPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="/movements" element={<Navigate to="/income" replace />} />
        <Route path="/movements/expenses" element={<Navigate to="/spending" replace />} />
        <Route path="/expenses" element={<Navigate to="/spending" replace />} />
        <Route path="/credit-cards" element={<Navigate to="/spending/credit-cards" replace />} />
        <Route path="/stocks/buys" element={<Navigate to="/investments/buys" replace />} />
        <Route path="/stocks/sells" element={<Navigate to="/investments/sells" replace />} />
        <Route path="/stocks/holdings" element={<Navigate to="/investments/holdings" replace />} />
        <Route path="/dividends" element={<Navigate to="/investments/dividends" replace />} />
        <Route path="/tickets" element={<LegacySectionRedirect to="/spending/tickets" />} />
        <Route path="/tickets/scan" element={<LegacySectionRedirect to="/spending/scan" />} />
        <Route
          path="/catalogs"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CatalogsPage />
            </Suspense>
          }
        />
        <Route
          path="/catalogs/:catalogKey"
          element={
            <Suspense fallback={<RouteFallback />}>
              <CatalogsPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
