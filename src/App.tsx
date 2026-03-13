import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { AppShell } from './layouts/AppShell';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const IncomePage = lazy(() => import('./pages/IncomePage').then((module) => ({ default: module.IncomePage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((module) => ({ default: module.ExpensesPage })));
const InvestmentsPage = lazy(() => import('./pages/InvestmentsPage').then((module) => ({ default: module.InvestmentsPage })));
const StockBuysPage = lazy(() => import('./pages/StockBuysPage').then((module) => ({ default: module.StockBuysPage })));
const StockSellsPage = lazy(() => import('./pages/StockSellsPage').then((module) => ({ default: module.StockSellsPage })));
const DividendsPage = lazy(() => import('./pages/DividendsPage').then((module) => ({ default: module.DividendsPage })));
const CatalogsPage = lazy(() => import('./pages/CatalogsPage').then((module) => ({ default: module.CatalogsPage })));

function RouteFallback() {
  return (
    <div className="page">
      <section className="card">
        <p className="card__text">Cargando modulo...</p>
      </section>
    </div>
  );
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
          path="/income"
          element={
            <Suspense fallback={<RouteFallback />}>
              <IncomePage />
            </Suspense>
          }
        />
        <Route
          path="/expenses"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ExpensesPage />
            </Suspense>
          }
        />
        <Route
          path="/investments"
          element={
            <Suspense fallback={<RouteFallback />}>
              <InvestmentsPage />
            </Suspense>
          }
        />
        <Route
          path="/stocks/buys"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StockBuysPage />
            </Suspense>
          }
        />
        <Route
          path="/stocks/sells"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StockSellsPage />
            </Suspense>
          }
        />
        <Route
          path="/dividends"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DividendsPage />
            </Suspense>
          }
        />
        <Route
          path="/catalogs"
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
