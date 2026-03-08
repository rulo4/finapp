import { useEffect, useState } from 'react';
import {
  checkSupabaseConnection,
  getSupabaseConfig,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase/client';

type IncomeDashboardRow = {
  id: string;
  entry_date: string;
  amount_mxn: number | null;
  income_sources: { name: string } | { name: string }[] | null;
};

type ExpenseDashboardRow = {
  id: string;
  entry_date: string;
  concept: string;
  total_amount_mxn: number;
  expense_categories: { name: string } | { name: string }[] | null;
};

type ActivityItem = {
  id: string;
  kind: 'income' | 'expense';
  title: string;
  subtitle: string;
  amountMxn: number;
  date: string;
};

function pickRelationName(relation: { name: string } | { name: string }[] | null) {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0]?.name ?? null : relation.name;
}

function getMonthWindow() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getYearWindow() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);

  return {
    start: start.toISOString().slice(0, 10),
    end: getTodayDate(),
  };
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function DashboardPage() {
  const defaultWindow = getMonthWindow();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>(
    isSupabaseConfigured() ? 'checking' : 'idle',
  );
  const [connectionMessage, setConnectionMessage] = useState(
    isSupabaseConfigured()
      ? 'Verificando acceso a la base local...'
      : 'Faltan variables de entorno de Supabase. Usa .env.local para conectar el proyecto.',
  );
  const [isMetricsLoading, setIsMetricsLoading] = useState(isSupabaseConfigured());
  const [dashboardMessage, setDashboardMessage] = useState('Cargando resumen real del usuario autenticado...');
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [netFlow, setNetFlow] = useState(0);
  const [activeSources, setActiveSources] = useState(0);
  const [activeCategories, setActiveCategories] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [periodStart, setPeriodStart] = useState(defaultWindow.start);
  const [periodEnd, setPeriodEnd] = useState(defaultWindow.end);
  const { url, anonKeyLoaded } = getSupabaseConfig();
  const hasInvalidRange = periodStart > periodEnd;

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    if (hasInvalidRange) {
      setDashboardMessage('El periodo no es valido: la fecha inicial debe ser menor o igual a la final.');
      setIsMetricsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadConnectionStatus() {
      setConnectionStatus('checking');
      setIsMetricsLoading(true);
      setDashboardMessage('Cargando resumen del periodo seleccionado...');

      const result = await checkSupabaseConnection();

      if (cancelled) {
        return;
      }

      setConnectionStatus(result.ok ? 'ok' : 'error');
      setConnectionMessage(result.message);

      if (!result.ok || !supabase) {
        setIsMetricsLoading(false);
        return;
      }

      const [incomePeriod, expensePeriod, incomeRecent, expenseRecent, sourcesResult, categoriesResult] =
        await Promise.all([
          supabase
            .from('income_entries')
            .select('amount_mxn, entry_date')
            .gte('entry_date', periodStart)
            .lte('entry_date', periodEnd),
          supabase
            .from('expense_entries')
            .select('total_amount_mxn, entry_date')
            .gte('entry_date', periodStart)
            .lte('entry_date', periodEnd),
          supabase
            .from('income_entries')
            .select('id, entry_date, amount_mxn, income_sources(name)')
            .gte('entry_date', periodStart)
            .lte('entry_date', periodEnd)
            .order('entry_date', { ascending: false })
            .limit(5),
          supabase
            .from('expense_entries')
            .select('id, entry_date, concept, total_amount_mxn, expense_categories(name)')
            .gte('entry_date', periodStart)
            .lte('entry_date', periodEnd)
            .order('entry_date', { ascending: false })
            .limit(5),
          supabase.from('income_sources').select('id', { count: 'exact', head: true }).eq('is_active', true),
          supabase.from('expense_categories').select('id', { count: 'exact', head: true }).eq('is_active', true),
        ]);

      if (cancelled) {
        return;
      }

      const firstError = [
        incomePeriod.error,
        expensePeriod.error,
        incomeRecent.error,
        expenseRecent.error,
        sourcesResult.error,
        categoriesResult.error,
      ].find(Boolean);

      if (firstError) {
        setDashboardMessage(`No fue posible cargar el resumen: ${firstError.message}`);
        setIsMetricsLoading(false);
        return;
      }

      const monthlyIncomeValue = ((incomePeriod.data as Array<{ amount_mxn: number | null }>) ?? []).reduce(
        (sum, row) => sum + Number(row.amount_mxn ?? 0),
        0,
      );
      const monthlyExpenseValue = ((expensePeriod.data as Array<{ total_amount_mxn: number }>) ?? []).reduce(
        (sum, row) => sum + Number(row.total_amount_mxn ?? 0),
        0,
      );
      const incomeActivity = ((incomeRecent.data as IncomeDashboardRow[]) ?? []).map((row) => ({
        id: `income-${row.id}`,
        kind: 'income' as const,
        title: pickRelationName(row.income_sources) ?? 'Ingreso',
        subtitle: 'Ingreso registrado',
        amountMxn: Number(row.amount_mxn ?? 0),
        date: row.entry_date,
      }));
      const expenseActivity = ((expenseRecent.data as ExpenseDashboardRow[]) ?? []).map((row) => ({
        id: `expense-${row.id}`,
        kind: 'expense' as const,
        title: row.concept,
        subtitle: pickRelationName(row.expense_categories) ?? 'Egreso registrado',
        amountMxn: Number(row.total_amount_mxn ?? 0),
        date: row.entry_date,
      }));

      setMonthlyIncome(monthlyIncomeValue);
      setMonthlyExpense(monthlyExpenseValue);
      setNetFlow(monthlyIncomeValue - monthlyExpenseValue);
      setActiveSources(sourcesResult.count ?? 0);
      setActiveCategories(categoriesResult.count ?? 0);
      setRecentActivity(
        [...incomeActivity, ...expenseActivity]
          .sort((left, right) => right.date.localeCompare(left.date))
          .slice(0, 6),
      );
      setDashboardMessage('Resumen cargado con datos reales del usuario autenticado para el periodo seleccionado.');
      setIsMetricsLoading(false);
    }

    void loadConnectionStatus();

    return () => {
      cancelled = true;
    };
  }, [hasInvalidRange, periodEnd, periodStart]);

  return (
    <div className="page">
      <section className="card dashboard-filters">
        <div className="dashboard-panel__header">
          <div>
            <h3 className="card__title">Periodo del dashboard</h3>
            <p className="card__text">Ajusta el rango de fechas para recalcular indicadores y actividad.</p>
          </div>
          <div className="dashboard-filters__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const monthWindow = getMonthWindow();
                setPeriodStart(monthWindow.start);
                setPeriodEnd(monthWindow.end);
              }}
            >
              Este mes
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const yearWindow = getYearWindow();
                setPeriodStart(yearWindow.start);
                setPeriodEnd(yearWindow.end);
              }}
            >
              Año actual
            </button>
          </div>
        </div>

        <div className="dashboard-filters__grid">
          <label className="field-label dashboard-filters__field">
            <span>Desde</span>
            <input type="date" value={periodStart} max={periodEnd || getTodayDate()} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>
          <label className="field-label dashboard-filters__field">
            <span>Hasta</span>
            <input type="date" value={periodEnd} min={periodStart} max={getTodayDate()} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
        </div>

        {hasInvalidRange ? (
          <p className="inline-hint">La fecha inicial no puede ser mayor que la fecha final.</p>
        ) : (
          <p className="inline-hint">
            Periodo activo: {dateFormatter.format(new Date(`${periodStart}T00:00:00`))} al{' '}
            {dateFormatter.format(new Date(`${periodEnd}T00:00:00`))}.
          </p>
        )}
      </section>

      <section className="kpi-grid">
        <article className="kpi">
          <span className="kpi__label">Flujo del periodo</span>
          <span className="kpi__value">{currencyFormatter.format(netFlow)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Ingresos del periodo</span>
          <span className="kpi__value">{currencyFormatter.format(monthlyIncome)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Egresos del periodo</span>
          <span className="kpi__value">{currencyFormatter.format(monthlyExpense)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Fuentes activas</span>
          <span className="kpi__value">{activeSources}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Categorias activas</span>
          <span className="kpi__value">{activeCategories}</span>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="card dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <h3 className="card__title">Actividad reciente</h3>
              <p className="card__text">Ultimos movimientos visibles bajo la sesion actual.</p>
            </div>
            <span className={`status-pill status-pill--${isMetricsLoading ? 'checking' : 'ok'}`}>
              {isMetricsLoading ? 'Cargando' : 'Actualizado'}
            </span>
          </div>

          {recentActivity.length > 0 ? (
            <div className="activity-list">
              {recentActivity.map((item) => (
                <div key={item.id} className="activity-row">
                  <div>
                    <div className="activity-row__title">{item.title}</div>
                    <div className="activity-row__meta">
                      {item.subtitle} · {dateFormatter.format(new Date(`${item.date}T00:00:00`))}
                    </div>
                  </div>
                  <div className={`activity-row__amount activity-row__amount--${item.kind}`}>
                    {item.kind === 'income' ? '+' : '-'}
                    {currencyFormatter.format(item.amountMxn)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="card__text">Aun no hay movimientos recientes para mostrar.</p>
          )}

          <p className="inline-hint">{dashboardMessage}</p>
        </article>

        <article className="card dashboard-panel">
          <h3 className="card__title">Estado inicial</h3>
          <div className="status-stack">
            <p className="card__text">
              {isSupabaseConfigured()
                ? 'Supabase está configurado para el entorno actual.'
                : 'Faltan variables de entorno de Supabase. Usa .env.local para conectar el proyecto.'}
            </p>
            <div className="status-list">
              <div className="status-row">
                <span className="status-row__label">Project URL</span>
                <span className="status-row__value">{url || 'No definida'}</span>
              </div>
              <div className="status-row">
                <span className="status-row__label">Anon key</span>
                <span className="status-row__value">{anonKeyLoaded ? 'Cargada' : 'Faltante'}</span>
              </div>
              <div className="status-row">
                <span className="status-row__label">Conexion</span>
                <span className={`status-pill status-pill--${connectionStatus}`}>
                  {connectionStatus === 'checking' && 'Verificando'}
                  {connectionStatus === 'ok' && 'Operativa'}
                  {connectionStatus === 'error' && 'Con error'}
                  {connectionStatus === 'idle' && 'Pendiente'}
                </span>
              </div>
            </div>
            <p className="inline-hint">{connectionMessage}</p>
          </div>
        </article>
      </section>
    </div>
  );
}
