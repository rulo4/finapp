import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataGrid, type Column, type RenderHeaderCellProps, type SortColumn } from 'react-data-grid';
import { type InvestmentDateFilterMode, type Security, formatCurrencyTotal, formatSecurityLabel, getDateRange, isErrorFeedback } from './shared';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import { summarizeOpenHoldings, type StockBuyMovement, type StockSellMovement } from './positionMetrics';

const GRID_ROW_HEIGHT = 40;
const FILTER_HEADER_ROW_HEIGHT = 64;

const HOLDING_COLUMN_ORDER = ['tickerLabel', 'companyName', 'quantityLabel', 'remainingUnitCostLabel', 'remainingFifoCostBasisLabel', 'portfolioWeightValue'] as const;
const REORDERABLE_HOLDING_COLUMNS = new Set<string>(['tickerLabel', 'portfolioWeightValue']);

type HoldingColumnKey = (typeof HOLDING_COLUMN_ORDER)[number];

type HoldingRow = {
  securityId: string;
  tickerLabel: string;
  companyName: string;
  quantityLabel: string;
  remainingUnitCostLabel: string;
  remainingFifoCostBasisLabel: string;
  portfolioWeightLabel: string;
  portfolioWeightValue: number | null;
  remainingFifoCostBasisValue: number;
};

function reorderColumns(order: readonly HoldingColumnKey[], sourceKey: string, targetKey: string) {
  if (!REORDERABLE_HOLDING_COLUMNS.has(sourceKey) || !REORDERABLE_HOLDING_COLUMNS.has(targetKey)) {
    return [...order];
  }

  const sourceIndex = order.findIndex((key) => key === sourceKey);
  const targetIndex = order.findIndex((key) => key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return [...order];
  }

  const nextOrder = [...order];
  const [source] = nextOrder.splice(sourceIndex, 1);
  nextOrder.splice(targetIndex, 0, source);
  return nextOrder;
}

function compareNullableNumber(left: number | null, right: number | null) {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return 1;
  }

  if (right == null) {
    return -1;
  }

  return left - right;
}

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
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [columnOrder, setColumnOrder] = useState<readonly HoldingColumnKey[]>(HOLDING_COLUMN_ORDER);
  const activeDateRange = useMemo(() => getDateRange(dateFilterMode), [dateFilterMode]);

  const loadData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no está configurado para este entorno.');
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
          portfolioWeightValue: totalRemainingFifoCostBasis > 0 ? holding.remainingFifoCostBasisMxn / totalRemainingFifoCostBasis : null,
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

  const renderTickerHeaderCell = useCallback(
    (props: RenderHeaderCellProps<HoldingRow>) => (
      <div className="grid-header-filter">
        <div className="grid-header-filter__label">Ticker</div>
        <input
          type="text"
          className="grid-header-filter__input"
          value={tickerFilter}
          placeholder="Filtrar"
          tabIndex={props.tabIndex}
          aria-label="Filtrar posiciones por ticker"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.stopPropagation();
            }
          }}
          onChange={(event) => {
            setTickerFilter(event.target.value);
          }}
        />
      </div>
    ),
    [tickerFilter],
  );

  const columnsByKey = useMemo<Record<HoldingColumnKey, Column<HoldingRow>>>(() => {
    return {
      tickerLabel: {
        key: 'tickerLabel',
        name: 'Ticker',
        width: 172,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderTickerHeaderCell,
        sortable: true,
        draggable: true,
      },
      companyName: {
        key: 'companyName',
        name: 'Empresa',
        width: 220,
      },
      quantityLabel: {
        key: 'quantityLabel',
        name: 'Titulos',
        width: 112,
      },
      remainingUnitCostLabel: {
        key: 'remainingUnitCostLabel',
        name: 'Costo unit. rem.',
        width: 128,
      },
      remainingFifoCostBasisLabel: {
        key: 'remainingFifoCostBasisLabel',
        name: 'Costo FIFO rem.',
        width: 132,
      },
      portfolioWeightValue: {
        key: 'portfolioWeightValue',
        name: 'Peso',
        width: 98,
        sortable: true,
        draggable: true,
        renderCell: ({ row }) => row.portfolioWeightLabel,
      },
    };
  }, [renderTickerHeaderCell]);

  const columns = useMemo<readonly Column<HoldingRow>[]>(() => columnOrder.map((key) => columnsByKey[key]), [columnOrder, columnsByKey]);

  const filteredRows = useMemo(() => {
    const normalizedFilter = tickerFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return rows;
    }

    return rows.filter((row) => row.tickerLabel.toLowerCase().includes(normalizedFilter) || row.companyName.toLowerCase().includes(normalizedFilter));
  }, [rows, tickerFilter]);

  const sortedRows = useMemo(() => {
    if (sortColumns.length === 0) {
      return filteredRows;
    }

    return [...filteredRows].sort((left, right) => {
      for (const sort of sortColumns) {
        const direction = sort.direction === 'ASC' ? 1 : -1;

        if (sort.columnKey === 'tickerLabel') {
          const result = left.tickerLabel.localeCompare(right.tickerLabel, 'es-MX');
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'portfolioWeightValue') {
          const result = compareNullableNumber(left.portfolioWeightValue, right.portfolioWeightValue);
          if (result !== 0) {
            return result * direction;
          }
        }
      }

      return 0;
    });
  }, [filteredRows, sortColumns]);

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
          </div>

          <div className="badge-row" aria-label="Resumen de posiciones visibles">
            <span className="badge">{summary.count} posiciones</span>
            <span className="badge">{summary.totalFifoLabel}</span>
          </div>
        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}

        {filteredRows.length > 0 ? (
          <div className="grid-wrapper grid-wrapper--tall">
            <DataGrid
              columns={columns}
              rows={sortedRows}
              rowHeight={GRID_ROW_HEIGHT}
              headerRowHeight={FILTER_HEADER_ROW_HEIGHT}
              rowKeyGetter={(row) => row.securityId}
              defaultColumnOptions={{ resizable: true }}
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              onColumnsReorder={(sourceColumnKey, targetColumnKey) => {
                setColumnOrder((currentOrder) => reorderColumns(currentOrder, sourceColumnKey, targetColumnKey));
              }}
              style={{ blockSize: 500 }}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}