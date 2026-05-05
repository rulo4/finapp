import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartColumn, faChartPie } from '@fortawesome/free-solid-svg-icons';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  checkSupabaseConnection,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase/client';
import { dashboardTabs, type DashboardTabKey } from '../config/navigation';
import {
  createCurrentInvestmentDateFilter,
  type InvestmentDateFilter,
  type Security,
  formatCurrencyTotal,
  getDateRange,
  getTodayDate,
} from '../features/investments/shared';
import { PeriodFilter } from '../features/shared/PeriodFilter';
import { summarizeOpenHoldings, type StockBuyMovement, type StockSellMovement } from '../features/investments/positionMetrics';

type IncomeDashboardRow = {
  entry_date: string;
  amount_mxn: number | null;
  income_sources: { name: string } | { name: string }[] | null;
};

type ExpenseDashboardRow = {
  entry_date: string;
  total_amount_mxn: number;
  expense_categories: { name: string } | { name: string }[] | null;
};

type InvestmentEntityDashboardRelation =
  | { name: string; is_closed: boolean }
  | { name: string; is_closed: boolean }[]
  | null;

type InvestmentMovementDashboardRow = {
  entry_date: string;
  amount_mxn: number;
  investment_entities: InvestmentEntityDashboardRelation;
};

type SecurityDashboardRow = Security & {
  sector: string | null;
  industry: string | null;
  instrument_type: string | null;
};

type StockBuyDashboardRow = {
  id: string;
  security_id: string;
  trade_date: string;
  quantity: number;
  unit_price_original: number;
  total_amount_mxn: number;
  created_at: string | null;
};

type StockSellDashboardRow = {
  id: string;
  security_id: string;
  trade_date: string;
  quantity: number;
  total_amount_mxn: number;
  created_at: string | null;
  stock_buy_id: string | null;
  sell_group_id: string | null;
};

type DashboardChartVariant = 'pie' | 'bar';

type DashboardChartDatum = {
  key: string;
  label: string;
  value: number;
  share: number | null;
  color: string;
  note?: string;
};

type DashboardData = {
  incomeBySource: DashboardChartDatum[];
  expensesByCategory: DashboardChartDatum[];
  investmentByInstrument: DashboardChartDatum[];
  investmentRealized: DashboardChartDatum[];
  investmentsBySecurity: DashboardChartDatum[];
  investmentsBySector: DashboardChartDatum[];
  investmentsByIndustry: DashboardChartDatum[];
};

type DashboardTooltipPayload = {
  active?: boolean;
  payload?: Array<{ payload: DashboardChartDatum }>;
};

const DASHBOARD_TAB_BY_ROUTE_SEGMENT: Partial<Record<string, DashboardTabKey>> = {
  expenses: 'expense',
  investments: 'investment',
  securities: 'security',
};

const CHART_COLORS = ['#0f766e', '#2563eb', '#ea580c', '#7c3aed', '#db2777', '#4f46e5', '#0891b2', '#65a30d', '#dc2626', '#ca8a04'];
const NEGATIVE_CHART_COLOR = '#b91c1c';

const EMPTY_DASHBOARD_DATA: DashboardData = {
  incomeBySource: [],
  expensesByCategory: [],
  investmentByInstrument: [],
  investmentRealized: [],
  investmentsBySecurity: [],
  investmentsBySector: [],
  investmentsByIndustry: [],
};

function pickRelationName(relation: { name: string } | { name: string }[] | null) {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0]?.name ?? null : relation.name;
}

function pickInvestmentEntityRelation(relation: InvestmentEntityDashboardRelation) {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function normalizeLabel(value: string | null | undefined, fallbackLabel: string) {
  const normalized = value?.trim();

  return normalized ? normalized : fallbackLabel;
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }

  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }

  return `$${Math.round(value)}`;
}

const percentageFormatter = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function buildChartData(entries: Array<{ label: string; value: number; note?: string }>) {
  const groupedEntries = new Map<string, { label: string; value: number; note?: string }>();

  for (const entry of entries) {
    if (!Number.isFinite(entry.value) || entry.value <= 0) {
      continue;
    }

    const existing = groupedEntries.get(entry.label);
    groupedEntries.set(entry.label, {
      label: entry.label,
      value: Number(((existing?.value ?? 0) + entry.value).toFixed(6)),
      note: existing?.note ?? entry.note,
    });
  }

  const sortedEntries = [...groupedEntries.values()].sort((left, right) => right.value - left.value);
  const total = sortedEntries.reduce((sum, entry) => sum + entry.value, 0);

  return sortedEntries.map((entry, index) => ({
    key: `${entry.label}-${index}`,
    label: entry.label,
    value: entry.value,
    share: total > 0 ? entry.value / total : null,
    color: CHART_COLORS[index % CHART_COLORS.length],
    note: entry.note,
  } satisfies DashboardChartDatum));
}

function buildSignedChartData(entries: Array<{ label: string; value: number; note?: string }>) {
  const groupedEntries = new Map<string, { value: number; note?: string }>();

  for (const entry of entries) {
    if (!Number.isFinite(entry.value) || entry.value === 0) {
      continue;
    }

    const existing = groupedEntries.get(entry.label);
    groupedEntries.set(entry.label, {
      value: Number(((existing?.value ?? 0) + entry.value).toFixed(6)),
      note: existing?.note ?? entry.note,
    });
  }

  const chartEntries = [...groupedEntries.entries()]
    .map(([label, entry], index) => ({
      key: `${label}-${index}`,
      label,
      value: entry.value,
      share: null,
      color: entry.value < 0 ? NEGATIVE_CHART_COLOR : CHART_COLORS[index % CHART_COLORS.length],
      note: entry.note,
    }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  const hasNegativeValues = chartEntries.some((entry) => entry.value < 0);
  if (hasNegativeValues) {
    return chartEntries;
  }

  const total = chartEntries.reduce((sum, entry) => sum + entry.value, 0);

  return chartEntries.map((entry) => ({
    ...entry,
    share: total > 0 ? entry.value / total : null,
  }));
}

function buildInvestmentFlowChartData(movements: InvestmentMovementDashboardRow[]) {
  return buildSignedChartData(
    movements.map((row) => {
      const relation = pickInvestmentEntityRelation(row.investment_entities);

      return {
        label: normalizeLabel(relation?.name, 'Sin entidad'),
        value: Number(row.amount_mxn ?? 0),
        note: relation?.is_closed ? 'Cerrada' : 'Abierta',
      };
    }),
  );
}

function buildInvestmentRealizedChartData(movements: InvestmentMovementDashboardRow[]) {
  const groupedEntries = new Map<string, number>();

  for (const row of movements) {
    const relation = pickInvestmentEntityRelation(row.investment_entities);
    if (!relation?.is_closed) {
      continue;
    }

    const label = normalizeLabel(relation.name, 'Sin entidad');
    const value = Number(row.amount_mxn ?? 0);

    if (!Number.isFinite(value) || value === 0) {
      continue;
    }

    groupedEntries.set(label, Number(((groupedEntries.get(label) ?? 0) + value).toFixed(6)));
  }

  return buildSignedChartData(
    [...groupedEntries.entries()].map(([label, netValue]) => ({
      label,
      value: Number((-netValue).toFixed(6)),
      note: 'Cerrada',
    })),
  );
}

function buildSecurityHoldingChartData(
  securities: SecurityDashboardRow[],
  buyRows: StockBuyDashboardRow[],
  sellRows: StockSellDashboardRow[],
  snapshotEndDate: string,
) {
  const filteredBuys = buyRows
    .filter((row) => row.trade_date <= snapshotEndDate)
    .map((row) => ({
      id: row.id,
      securityId: row.security_id,
      tradeDate: row.trade_date,
      quantity: Number(row.quantity),
      unitPriceOriginal: Number(row.unit_price_original),
      totalAmountMxn: Number(row.total_amount_mxn),
      createdAt: row.created_at,
    })) satisfies StockBuyMovement[];
  const filteredSells = sellRows
    .filter((row) => row.trade_date <= snapshotEndDate)
    .map((row) => ({
      id: row.id,
      securityId: row.security_id,
      tradeDate: row.trade_date,
      quantity: Number(row.quantity),
      totalAmountMxn: Number(row.total_amount_mxn),
      createdAt: row.created_at,
      stockBuyId: row.stock_buy_id,
      sellGroupId: row.sell_group_id,
    })) satisfies StockSellMovement[];
  const securityById = new Map(securities.map((security) => [security.id, security]));
  const holdingSummaries = summarizeOpenHoldings(filteredBuys, filteredSells);

  return {
    investmentsBySecurity: buildChartData(
      holdingSummaries.map((holding) => {
        const security = securityById.get(holding.securityId);

        return {
          label: security?.ticker?.trim() || 'Valor desconocido',
          value: holding.remainingFifoCostBasisMxn,
        };
      }),
    ),
    investmentsBySector: buildChartData(
      holdingSummaries.map((holding) => ({
        label: normalizeLabel(securityById.get(holding.securityId)?.sector, 'Sin clasificar'),
        value: holding.remainingFifoCostBasisMxn,
      })),
    ),
    investmentsByIndustry: buildChartData(
      holdingSummaries.map((holding) => ({
        label: normalizeLabel(securityById.get(holding.securityId)?.industry, 'Sin clasificar'),
        value: holding.remainingFifoCostBasisMxn,
      })),
    ),
  };
}

function DashboardTooltip({ active, payload }: DashboardTooltipPayload) {
  if (!active || !payload?.length) {
    return null;
  }

  const item = payload[0]?.payload;
  if (!item) {
    return null;
  }

  return (
    <div className="dashboard-tooltip">
      <strong>{item.label}</strong>
      {item.note ? <span>{item.note}</span> : null}
      <span>{formatCurrencyTotal(item.value)}</span>
      {item.share != null ? <span>{percentageFormatter.format(item.share)}</span> : null}
    </div>
  );
}

function DashboardChartCard({
  title,
  description,
  data,
  chartVariant,
  emptyMessage,
  showLegend = true,
  compactMeta = false,
}: {
  title: string;
  description?: string;
  data: DashboardChartDatum[];
  chartVariant: DashboardChartVariant;
  emptyMessage: string;
  showLegend?: boolean;
  compactMeta?: boolean;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const hasNegativeValues = data.some((item) => item.value < 0);
  const effectiveChartVariant = hasNegativeValues ? 'bar' : chartVariant;
  const chartHeight = effectiveChartVariant === 'pie' ? 320 : Math.max(280, data.length * 52);

  return (
    <article className="card dashboard-chart-panel">
      <div className="dashboard-panel__header">
        <div>
          <h3 className="card__title">{title}</h3>
          {description ? <p className="card__text">{description}</p> : null}
        </div>
        <div className={`dashboard-chart-panel__meta ${compactMeta ? 'dashboard-chart-panel__meta--inline' : ''}`}>
          <span className="dashboard-stat">{data.length || 0} grupos</span>
          <span className="dashboard-stat dashboard-stat--strong">{formatCurrencyTotal(total)}</span>
        </div>
      </div>

      {hasNegativeValues ? <p className="card__text">Se usa barra para conservar signo.</p> : null}

      {data.length > 0 ? (
        <div className={`dashboard-chart dashboard-chart--${effectiveChartVariant} ${showLegend ? '' : 'dashboard-chart--legendless'}`}>
          <div className={`dashboard-chart__visual dashboard-chart__visual--${effectiveChartVariant}`} style={{ height: `${chartHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              {effectiveChartVariant === 'pie' ? (
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={72}
                    outerRadius={110}
                    paddingAngle={2}
                    stroke="#ffffff"
                    strokeWidth={2}
                  >
                    {data.map((item) => (
                      <Cell key={item.key} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<DashboardTooltip />} />
                </PieChart>
              ) : (
                <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 6 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal />
                  <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    domain={['auto', 'auto']}
                    tickFormatter={formatCompactCurrency}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={96}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <Tooltip content={<DashboardTooltip />} />
                  <Bar dataKey="value">
                    {data.map((item) => (
                      <Cell key={item.key} fill={item.color} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          {showLegend ? (
            <ol className="dashboard-legend">
              {data.map((item) => (
                <li key={item.key} className="dashboard-legend__item">
                  <div className="dashboard-legend__label">
                    <span className="dashboard-legend__dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                    <div>
                      <strong>{item.label}</strong>
                      {item.note ? <span>{item.note}</span> : null}
                    </div>
                  </div>
                  <div className="dashboard-legend__values">
                    <strong>{formatCurrencyTotal(item.value)}</strong>
                    {item.share != null ? <span>{percentageFormatter.format(item.share)}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <p className="card__text">{emptyMessage}</p>
      )}
    </article>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { dashboardTab } = useParams<{ dashboardTab?: string }>();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>(
    isSupabaseConfigured() ? 'checking' : 'idle',
  );
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured());
  const [periodFilter, setPeriodFilter] = useState<InvestmentDateFilter>(() => createCurrentInvestmentDateFilter());
  const [chartVariants, setChartVariants] = useState<Record<DashboardTabKey, DashboardChartVariant>>({
    income: 'pie',
    expense: 'pie',
    investment: 'pie',
    security: 'bar',
  });
  const [dashboardData, setDashboardData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const activeTab = dashboardTab ? DASHBOARD_TAB_BY_ROUTE_SEGMENT[dashboardTab] ?? 'income' : 'income';
  const activePeriod = useMemo(() => getDateRange(periodFilter), [periodFilter]);
  const snapshotEndDate = activePeriod.end || getTodayDate();
  const activeChartVariant = chartVariants[activeTab];
  const nextChartVariant = activeChartVariant === 'pie' ? 'bar' : 'pie';
  const activeDashboardTab = dashboardTabs.find((tab) => {
    const tabKey: DashboardTabKey =
      tab.to === '/dashboard'
        ? 'income'
        : tab.to === '/dashboard/expenses'
          ? 'expense'
          : tab.to === '/dashboard/investments'
            ? 'investment'
            : 'security';

    return tabKey === activeTab;
  }) ?? dashboardTabs[0];

  useEffect(() => {
    if (dashboardTab && !(dashboardTab in DASHBOARD_TAB_BY_ROUTE_SEGMENT)) {
      navigate('/dashboard', { replace: true });
    }
  }, [dashboardTab, navigate]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let cancelled = false;

    async function loadDashboardData() {
      setConnectionStatus('checking');
      setIsLoading(true);

      const result = await checkSupabaseConnection();

      if (cancelled) {
        return;
      }

      setConnectionStatus(result.ok ? 'ok' : 'error');

      if (!result.ok || !supabase) {
        setIsLoading(false);
        return;
      }

      let incomeQuery = supabase.from('income_entries').select('entry_date, amount_mxn, income_sources(name)');
      let expenseQuery = supabase.from('expense_entries').select('entry_date, total_amount_mxn, expense_categories(name)');
      let investmentQuery = supabase
        .from('investment_movements')
        .select('entry_date, amount_mxn, investment_entities(name, is_closed)');
      const lifetimeInvestmentQuery = supabase
        .from('investment_movements')
        .select('entry_date, amount_mxn, investment_entities(name, is_closed)');

      if (activePeriod.start) {
        incomeQuery = incomeQuery.gte('entry_date', activePeriod.start);
        expenseQuery = expenseQuery.gte('entry_date', activePeriod.start);
        investmentQuery = investmentQuery.gte('entry_date', activePeriod.start);
      }

      if (activePeriod.end) {
        incomeQuery = incomeQuery.lte('entry_date', activePeriod.end);
        expenseQuery = expenseQuery.lte('entry_date', activePeriod.end);
        investmentQuery = investmentQuery.lte('entry_date', activePeriod.end);
      }

      const [incomeResult, expenseResult, investmentResult, lifetimeInvestmentResult, securitiesResult, buyResult, sellResult] = await Promise.all([
        incomeQuery,
        expenseQuery,
        investmentQuery,
        lifetimeInvestmentQuery,
        supabase
          .from('securities')
          .select('id, ticker, company_name, sector, industry, exchange_code, instrument_type, is_active')
          .order('ticker', { ascending: true }),
        supabase
          .from('stock_buys')
          .select('id, security_id, trade_date, quantity, unit_price_original, total_amount_mxn, created_at')
          .lte('trade_date', snapshotEndDate),
        supabase
          .from('stock_sells')
          .select('id, security_id, trade_date, quantity, total_amount_mxn, created_at, stock_buy_id, sell_group_id')
          .lte('trade_date', snapshotEndDate),
      ]);

      if (cancelled) {
        return;
      }

      const firstError = [incomeResult.error, expenseResult.error, investmentResult.error, lifetimeInvestmentResult.error, securitiesResult.error, buyResult.error, sellResult.error].find(Boolean);

      if (firstError) {
        setDashboardData(EMPTY_DASHBOARD_DATA);
        setIsLoading(false);
        return;
      }

      const incomeBySource = buildChartData(
        ((incomeResult.data as IncomeDashboardRow[]) ?? []).map((row) => ({
          label: normalizeLabel(pickRelationName(row.income_sources), 'Sin fuente'),
          value: Number(row.amount_mxn ?? 0),
        })),
      );
      const expensesByCategory = buildChartData(
        ((expenseResult.data as ExpenseDashboardRow[]) ?? []).map((row) => ({
          label: normalizeLabel(pickRelationName(row.expense_categories), 'Sin categoría'),
          value: Number(row.total_amount_mxn ?? 0),
        })),
      );
      const investmentByInstrument = buildInvestmentFlowChartData(
        (investmentResult.data as InvestmentMovementDashboardRow[]) ?? [],
      );
      const investmentRealized = buildInvestmentRealizedChartData(
        (lifetimeInvestmentResult.data as InvestmentMovementDashboardRow[]) ?? [],
      );

      const holdingsCharts = buildSecurityHoldingChartData(
        (securitiesResult.data as SecurityDashboardRow[]) ?? [],
        (buyResult.data as StockBuyDashboardRow[]) ?? [],
        (sellResult.data as StockSellDashboardRow[]) ?? [],
        snapshotEndDate,
      );

      setDashboardData({
        incomeBySource,
        expensesByCategory,
        investmentByInstrument,
        investmentRealized,
        ...holdingsCharts,
      });
      setIsLoading(false);
    }

    void loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, [activePeriod.end, activePeriod.start, snapshotEndDate]);

  const dashboardContent =
    activeTab === 'income' ? (
      <div className="dashboard-tab-grid">
        <DashboardChartCard
          title="Ingresos por fuente"
          description="Suma de ingresos MXN agrupados por fuente dentro del periodo activo."
          data={dashboardData.incomeBySource}
          chartVariant={activeChartVariant}
          emptyMessage="No hay ingresos visibles en el periodo actual."
        />
      </div>
    ) : activeTab === 'expense' ? (
      <div className="dashboard-tab-grid">
        <DashboardChartCard
          title="Egresos por categoría"
          description="Suma de egresos MXN agrupados por categoría dentro del periodo activo."
          data={dashboardData.expensesByCategory}
          chartVariant={activeChartVariant}
          emptyMessage="No hay egresos visibles en el periodo actual."
        />
      </div>
    ) : activeTab === 'investment' ? (
      <div className="dashboard-tab-grid dashboard-tab-grid--investment">
        <DashboardChartCard
          title="Flujo neto"
          description="Abono - retiro por entidad."
          data={dashboardData.investmentByInstrument}
          chartVariant={activeChartVariant}
          emptyMessage="No hay flujo en el periodo."
          compactMeta
        />
        <DashboardChartCard
          title="Realizado"
          description="Solo cerradas, total."
          data={dashboardData.investmentRealized}
          chartVariant={activeChartVariant}
          emptyMessage="No hay realizado."
          compactMeta
        />
      </div>
    ) : (
      <div className="dashboard-tab-grid dashboard-tab-grid--security">
        <DashboardChartCard
          title="Inversión por security"
          data={dashboardData.investmentsBySecurity}
          chartVariant={activeChartVariant}
          emptyMessage="No hay cartera abierta al corte del periodo para mostrar por security."
          compactMeta
        />
        <DashboardChartCard
          title="Inversión por sector"
          data={dashboardData.investmentsBySector}
          chartVariant={activeChartVariant}
          emptyMessage="No hay cartera abierta al corte del periodo para mostrar por sector."
          compactMeta
        />
        <DashboardChartCard
          title="Inversión por industria"
          data={dashboardData.investmentsByIndustry}
          chartVariant={activeChartVariant}
          emptyMessage="No hay cartera abierta al corte del periodo para mostrar por industria."
          compactMeta
        />
      </div>
    );

  return (
    <div className="page dashboard-page">
      <section className="card dashboard-filters">
        <div className="dashboard-toolbar">
          <PeriodFilter ariaLabel="Filtro de periodo del dashboard" value={periodFilter} onChange={setPeriodFilter} disabled={isLoading} />

          <button
            type="button"
            className="dashboard-chart-switch"
            aria-label={`Cambiar a vista ${nextChartVariant === 'pie' ? 'pie' : 'bar'}`}
            title={`Cambiar a ${nextChartVariant === 'pie' ? 'pie' : 'bar'}`}
            onClick={() =>
              setChartVariants((current) => ({
                ...current,
                [activeTab]: nextChartVariant,
              }))
            }
          >
            <span
              className={`dashboard-chart-switch__option ${activeChartVariant === 'pie' ? 'dashboard-chart-switch__option--active' : ''}`}
              aria-hidden="true"
            >
              <FontAwesomeIcon icon={faChartPie} />
            </span>
            <span
              className={`dashboard-chart-switch__option ${activeChartVariant === 'bar' ? 'dashboard-chart-switch__option--active' : ''}`}
              aria-hidden="true"
            >
              <FontAwesomeIcon icon={faChartColumn} />
            </span>
            {isLoading ? <span className="dashboard-chart-switch__spinner" aria-hidden="true" /> : null}
          </button>

          <div className="dashboard-tabs-wrap">
            <div className="dashboard-tabs" role="tablist" aria-label="Seleccionar dashboard activo">
              {dashboardTabs.map((tab) => {
                const tabKey: DashboardTabKey =
                  tab.to === '/dashboard'
                    ? 'income'
                    : tab.to === '/dashboard/expenses'
                      ? 'expense'
                      : tab.to === '/dashboard/investments'
                        ? 'investment'
                        : 'security';
                const isActive = activeTab === tabKey;

                return (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    end={tab.end ?? true}
                    role="tab"
                    aria-selected={isActive}
                    className={`dashboard-tabs__button ${isActive ? 'dashboard-tabs__button--active' : ''}`}
                    title={tab.label}
                    aria-label={tab.label}
                  >
                    <FontAwesomeIcon icon={tab.icon} className="dashboard-tabs__icon" />
                    {isActive ? <span className="dashboard-tabs__label">{tab.label}</span> : null}
                  </NavLink>
                );
              })}
            </div>

            <div className="dashboard-tabs__current" aria-live="polite">
              {activeDashboardTab.label}
            </div>
          </div>
        </div>

      </section>

      {dashboardContent}
    </div>
  );
}
