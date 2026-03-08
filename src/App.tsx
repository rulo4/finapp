import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { AppShell } from './layouts/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { IncomePage } from './pages/IncomePage';
import { ExpensesPage } from './pages/ExpensesPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { StockBuysPage } from './pages/StockBuysPage';
import { StockSellsPage } from './pages/StockSellsPage';
import { DividendsPage } from './pages/DividendsPage';
import { CatalogsPage } from './pages/CatalogsPage';

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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/income" element={<IncomePage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/investments" element={<InvestmentsPage />} />
        <Route path="/stocks/buys" element={<StockBuysPage />} />
        <Route path="/stocks/sells" element={<StockSellsPage />} />
        <Route path="/dividends" element={<DividendsPage />} />
        <Route path="/catalogs" element={<CatalogsPage />} />
      </Route>
    </Routes>
  );
}
