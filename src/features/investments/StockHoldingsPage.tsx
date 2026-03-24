import { useCallback, useEffect, useMemo, useState } from 'react';
import { type InvestmentDateFilterMode, type Security, formatCurrencyTotal, formatSecurityLabel, getDateRange, isErrorFeedback } from './shared';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import { summarizeOpenHoldings, type StockBuyMovement, type StockSellMovement } from './positionMetrics';

type HoldingRow = {
  securityId: string;
  tickerLabel: string;
  companyName: string;
  quantityLabel: string;
  remainingUnitCostLabel: string;
  remainingFifoCostBasisLabel: string;
  portfolioWeightLabel: string;
  remainingFifoCostBasisValue: number;
};

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('es-MX', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function StockHoldingsPage() {
  const [dateFilterMode, setDateFilterMode] = useState<InvestmentDateFilterMode>('year');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [tickerFilter, setTickerFilter] = useState('');
  const activeDateRange = useMemo(() => getDateRange(dateFilterMode), [dateFilterMode]);

  const loadData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no esta configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    const [{ data: securityData, error: securityError }, { data: buyData, error: buyError }, { data: sellData, error: sellError }] = await Promise.all([
      supabase.from('securities').select('id, ticker, company_name, exchange_code, is_active').order('ticker', { ascending: true }),
      supabase.from('stock_buys').select('id, security_id, trade_date, quantity, unit_price_original, total_amount_mxn, created_at'),
      supabase.from('stock_sells').select('id, security_id, trade_date, quantity, total_amount_mxn, created_at, stock_buy_id, sell_group_id'),
    ]);

    if (securityError) {
      setFeedback(`No fue posible cargar valores bursátiles: ${securityError.message}`);
      setIsLoading(false);
      return;
    }

    if (buyError || sellError) {
      setFeedback(`No fue posible cargar el historial de acciones: ${buyError?.message ?? sellError?.message}`);
      setIsLoading(false);
      return;
    }

    const securities = new Map(((securityData as Security[]) ?? []).map((security) => [security.id, security]));
    const buys = (((buyData as Array<{ id: string; security_id: string; trade_date: string; quantity: number; unit_price_original: number; total_amount_mxn: number; created_at: string }>) ?? [])
      .filter((row) => !activeDateRange.end || row.trade_date <= activeDateRange.end)
      .map((row) => ({
        id: row.id,
        securityId: row.security_id,
        tradeDate: row.trade_date,
        quantity: Number(row.quantity),
        unitPriceOriginal: Number(row.unit_price_original),
        totalAmountMxn: Number(row.total_amount_mxn),
        createdAt: row.created_at,
      }))) satisfies StockBuyMovement[];
    const sells = (((sellData as Array<{ id: string; security_id: string; trade_date: string; quantity: number; total_amount_mxn: number; created_at: string; stock_buy_id: string | null; sell_group_id: string | null }>) ?? [])
      .filter((row) => !activeDateRange.end || row.trade_date <= activeDateRange.end)
      .map((row) => ({
        id: row.id,
        securityId: row.security_id,
        tradeDate: row.trade_date,
        quantity: Number(row.quantity),
        totalAmountMxn: Number(row.total_amount_mxn),
        createdAt: row.created_at,
        stockBuyId: row.stock_buy_id,
        sellGroupId: row.sell_group_id,
      }))) satisfies StockSellMovement[];

    const holdingSummaries = summarizeOpenHoldings(buys, sells);
    const totalRemainingFifoCostBasis = holdingSummaries.reduce((sum, row) => sum + row.remainingFifoCostBasisMxn, 0);
    const nextRows = holdingSummaries
      .map((holding) => {
        const security = securities.get(holding.securityId);
        if (!security) {
          return null;
        }

        return {
          securityId: holding.securityId,
          tickerLabel: formatSecurityLabel(security),
          companyName: security.company_name,
          quantityLabel: formatQuantity(holding.availableQuantity),
          remainingUnitCostLabel: formatCurrencyTotal(holding.remainingUnitCostMxn),
          remainingFifoCostBasisLabel: formatCurrencyTotal(holding.remainingFifoCostBasisMxn),
          portfolioWeightLabel: formatPercent(
            totalRemainingFifoCostBasis > 0 ? holding.remainingFifoCostBasisMxn / totalRemainingFifoCostBasis : null,
          ),
          remainingFifoCostBasisValue: holding.remainingFifoCostBasisMxn,
        } satisfies HoldingRow;
      })
      .filter((row): row is HoldingRow => row != null)
      .sort((left, right) => right.remainingFifoCostBasisValue - left.remainingFifoCostBasisValue);

    setRows(nextRows);
    setFeedback(nextRows.length === 0 ? 'No hay posiciones abiertas con el rango actual.' : null);
    setIsLoading(false);
  }, [activeDateRange.end]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const normalizedFilter = tickerFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return rows;
    }

    return rows.filter((row) => row.tickerLabel.toLowerCase().includes(normalizedFilter) || row.companyName.toLowerCase().includes(normalizedFilter));
  }, [rows, tickerFilter]);

  const summary = useMemo(() => {
    return {
      count: filteredRows.length,
      totalFifoLabel: formatCurrencyTotal(filteredRows.reduce((sum, row) => sum + row.remainingFifoCostBasisValue, 0)),
    };
  }, [filteredRows]);

  return (
    <div className="page">
      <section className="card finance-panel">
        <div className="income-toolbar">
          <div className="income-toolbar__controls">
            <div className="income-period-filter" role="group" aria-label="Filtrar posiciones por fecha">
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'all' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => setDateFilterMode('all')}
                disabled={isLoading}
              >
                Todo
              </button>
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'month' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => setDateFilterMode('month')}
                disabled={isLoading}
              >
                Este mes
              </button>
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'year' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => setDateFilterMode('year')}
                disabled={isLoading}
              >
                Este año
              </button>
            </div>

            <label className="holdings-filter">
              <span className="holdings-filter__label">Ticker</span>
              <input
                type="text"
                className="holdings-filter__input"
                value={tickerFilter}
                placeholder="Filtrar"
                onChange={(event) => setTickerFilter(event.target.value)}
              />
            </label>
          </div>

          <div className="badge-row" aria-label="Resumen de posiciones visibles">
            <span className="badge">{summary.count} posiciones</span>
            <span className="badge">{summary.totalFifoLabel}</span>
          </div>
        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}

        {filteredRows.length > 0 ? (
          <div className="finance-panel__summary">
            <div className="finance-table finance-table--stock-holdings" aria-label="Resumen de posiciones abiertas por valor">
              <div className="finance-table__head">
                <span>Ticker</span>
                <span>Empresa</span>
                <span>Títulos</span>
                <span>Costo unit. rem.</span>
                <span>Costo FIFO rem.</span>
                <span>Peso</span>
              </div>

              {filteredRows.map((row) => (
                <div key={row.securityId} className="finance-table__row">
                  <span>{row.tickerLabel}</span>
                  <span>{row.companyName}</span>
                  <span>{row.quantityLabel}</span>
                  <span>{row.remainingUnitCostLabel}</span>
                  <span>{row.remainingFifoCostBasisLabel}</span>
                  <span>{row.portfolioWeightLabel}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}