import { useCallback, useEffect, useMemo, useState } from 'react';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { DataGrid, type Column, type RenderHeaderCellProps, type SortColumn } from 'react-data-grid';
import { useAuth } from '../auth/AuthContext';
import { createCurrentInvestmentDateFilter, type InvestmentDateFilter, type Security, formatCurrencyTotal, formatPercentage, formatSecurityLabel, getDateRange, isErrorFeedback } from './shared';
import { getHoldingQuotesUserId, isHoldingQuoteStale, mergeHoldingQuotesCache, readHoldingQuotesCache, requestHoldingQuotes, type HoldingQuote, type QuoteRequestItem, writeHoldingQuotesCache } from './holdingQuotes';
import { AppSelect, type SelectOption } from '../shared/gridEditors';
import { PeriodFilter } from '../shared/PeriodFilter';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import { summarizeOpenHoldings, type StockBuyMovement, type StockSellMovement } from './positionMetrics';

const GRID_ROW_HEIGHT = 40;
const FILTER_HEADER_ROW_HEIGHT = 64;
const ACTION_COLUMN_WIDTH = 64;

const HOLDING_COLUMN_ORDER = [
  'actions',
  'tickerLabel',
  'companyName',
  'quantityLabel',
  'remainingUnitCostLabel',
  'remainingFifoCostBasisLabel',
  'portfolioWeightValue',
  'marketWeightValue',
  'unrealizedPnlMxn',
  'unrealizedPnlPct',
  'currentPrice',
  'sourceCurrencyCode',
  'currentPriceMxn',
  'changeAmountMxn',
  'changePercent',
  'dayRangeMxn',
  'priceTimestamp',
  'providerId',
  'quoteStatus',
] as const;
const REORDERABLE_HOLDING_COLUMNS = new Set<string>(['tickerLabel', 'portfolioWeightValue']);

type HoldingColumnKey = (typeof HOLDING_COLUMN_ORDER)[number];

type HoldingRow = {
  securityId: string;
  ticker: string;
  exchangeCode: string | null;
  tickerLabel: string;
  companyName: string;
  quantityLabel: string;
  quantityValue: number;
  remainingUnitCostLabel: string;
  remainingFifoCostBasisLabel: string;
  portfolioWeightLabel: string;
  portfolioWeightValue: number | null;
  remainingFifoCostBasisValue: number;
  marketWeightValue: number | null;
  marketWeightLabel: string;
  unrealizedPnlMxn: number | null;
  unrealizedPnlMxnLabel: string;
  unrealizedPnlPct: number | null;
  unrealizedPnlPctLabel: string;
  currentPrice: number | null;
  currentPriceLabel: string;
  sourceCurrencyCode: string | null;
  currentPriceMxn: number | null;
  currentPriceMxnLabel: string;
  changeAmount: number | null;
  changeAmountLabel: string;
  changeAmountMxn: number | null;
  changeAmountMxnLabel: string;
  changePercent: number | null;
  changePercentLabel: string;
  dayHigh: number | null;
  dayHighLabel: string;
  dayHighMxn: number | null;
  dayHighMxnLabel: string;
  dayLow: number | null;
  dayLowLabel: string;
  dayLowMxn: number | null;
  dayLowMxnLabel: string;
  dayRangeMxnLabel: string;
  priceTimestamp: string | null;
  priceTimestampLabel: string;
  providerId: string | null;
  providerLabel: string;
  quoteStatus: 'Sin datos' | 'Actualizado' | 'Desactualizado' | 'Error' | 'Actualizando';
  quoteStatusLabel: string;
  quoteError: string | null;
  isRefreshingQuote: boolean;
};

type HoldingQuotePresentation = Pick<
  HoldingRow,
  | 'marketWeightValue'
  | 'marketWeightLabel'
  | 'unrealizedPnlMxn'
  | 'unrealizedPnlMxnLabel'
  | 'unrealizedPnlPct'
  | 'unrealizedPnlPctLabel'
  | 'currentPrice'
  | 'currentPriceLabel'
  | 'sourceCurrencyCode'
  | 'currentPriceMxn'
  | 'currentPriceMxnLabel'
  | 'changeAmount'
  | 'changeAmountLabel'
  | 'changeAmountMxn'
  | 'changeAmountMxnLabel'
  | 'changePercent'
  | 'changePercentLabel'
  | 'dayHigh'
  | 'dayHighLabel'
  | 'dayHighMxn'
  | 'dayHighMxnLabel'
  | 'dayLow'
  | 'dayLowLabel'
  | 'dayLowMxn'
  | 'dayLowMxnLabel'
  | 'dayRangeMxnLabel'
  | 'priceTimestamp'
  | 'priceTimestampLabel'
  | 'providerId'
  | 'providerLabel'
  | 'quoteStatus'
  | 'quoteStatusLabel'
  | 'quoteError'
  | 'isRefreshingQuote'
>;

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

function formatPrice(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatQuoteTimestamp(value: string | null) {
  if (!value) {
    return '—';
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return '—';
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

function getSignedToneClass(value: number | null) {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return '';
  }

  return value > 0 ? 'trade-cell-value trade-cell-value--positive' : 'trade-cell-value trade-cell-value--negative';
}

function buildQuoteRequestItem(row: Pick<HoldingRow, 'securityId' | 'ticker' | 'exchangeCode'>): QuoteRequestItem {
  return {
    securityId: row.securityId,
    ticker: row.ticker,
    exchangeCode: row.exchangeCode,
  };
}

function deriveQuotePresentation(quote: HoldingQuote | null, errorMessage: string | null, isRefreshingQuote: boolean): HoldingQuotePresentation {
  const stale = quote ? isHoldingQuoteStale(quote) : false;
  const quoteStatus: HoldingRow['quoteStatus'] = isRefreshingQuote ? 'Actualizando' : errorMessage ? 'Error' : quote ? (stale ? 'Desactualizado' : 'Actualizado') : 'Sin datos';

  return {
    marketWeightValue: null,
    marketWeightLabel: '—',
    unrealizedPnlMxn: null,
    unrealizedPnlMxnLabel: '—',
    unrealizedPnlPct: null,
    unrealizedPnlPctLabel: '—',
    currentPrice: quote?.currentPrice ?? null,
    currentPriceLabel: formatPrice(quote?.currentPrice ?? null),
    sourceCurrencyCode: quote?.sourceCurrencyCode ?? null,
    currentPriceMxn: quote?.currentPriceMxn ?? null,
    currentPriceMxnLabel: quote ? formatCurrencyTotal(quote.currentPriceMxn) : '—',
    changeAmount: quote?.changeAmount ?? null,
    changeAmountLabel: formatPrice(quote?.changeAmount ?? null),
    changeAmountMxn: quote?.changeAmountMxn ?? null,
    changeAmountMxnLabel: quote?.changeAmountMxn != null ? formatCurrencyTotal(quote.changeAmountMxn) : '—',
    changePercent: quote?.changePercent ?? null,
    changePercentLabel: formatPercentage(quote?.changePercent ?? null),
    dayHigh: quote?.dayHigh ?? null,
    dayHighLabel: formatPrice(quote?.dayHigh ?? null),
    dayHighMxn: quote?.dayHighMxn ?? null,
    dayHighMxnLabel: quote?.dayHighMxn != null ? formatCurrencyTotal(quote.dayHighMxn) : '—',
    dayLow: quote?.dayLow ?? null,
    dayLowLabel: formatPrice(quote?.dayLow ?? null),
    dayLowMxn: quote?.dayLowMxn ?? null,
    dayLowMxnLabel: quote?.dayLowMxn != null ? formatCurrencyTotal(quote.dayLowMxn) : '—',
    dayRangeMxnLabel:
      quote?.dayLowMxn != null || quote?.dayHighMxn != null
        ? `${quote?.dayLowMxn != null ? formatCurrencyTotal(quote.dayLowMxn) : '—'} / ${quote?.dayHighMxn != null ? formatCurrencyTotal(quote.dayHighMxn) : '—'}`
        : '—',
    priceTimestamp: quote?.priceTimestamp ?? null,
    priceTimestampLabel: formatQuoteTimestamp(quote?.priceTimestamp ?? null),
    providerId: quote?.providerId ?? null,
    providerLabel: quote?.providerId === 'finnhub' ? 'Finnhub' : quote?.providerId === 'databursatil' ? 'DataBursátil' : '—',
    quoteStatus,
    quoteStatusLabel: quoteStatus,
    quoteError: errorMessage,
    isRefreshingQuote,
  };
}

export function StockHoldingsPage() {
  const { user } = useAuth();
  const [dateFilter, setDateFilter] = useState<InvestmentDateFilter>(() => createCurrentInvestmentDateFilter());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [quotesBySecurityId, setQuotesBySecurityId] = useState<Map<string, HoldingQuote>>(new Map());
  const [quoteErrorsBySecurityId, setQuoteErrorsBySecurityId] = useState<Map<string, string>>(new Map());
  const [refreshingSecurityIds, setRefreshingSecurityIds] = useState<Set<string>>(new Set());
  const [isRefreshingAllQuotes, setIsRefreshingAllQuotes] = useState(false);
  const [tickerFilter, setTickerFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [columnOrder, setColumnOrder] = useState<readonly HoldingColumnKey[]>(HOLDING_COLUMN_ORDER);
  const activeDateRange = useMemo(() => getDateRange(dateFilter), [dateFilter]);
  const quotesUserId = getHoldingQuotesUserId(user);

  const currencyFilterOptions = useMemo<readonly SelectOption[]>(() => [{ value: '', label: 'Todas' }, { value: 'USD', label: 'USD' }, { value: 'MXN', label: 'MXN' }], []);
  const providerFilterOptions = useMemo<readonly SelectOption[]>(() => [{ value: '', label: 'Todos' }, { value: 'finnhub', label: 'Finnhub' }, { value: 'databursatil', label: 'DataBursátil' }], []);
  const statusFilterOptions = useMemo<readonly SelectOption[]>(() => [{ value: '', label: 'Todos' }, { value: 'Sin datos', label: 'Sin datos' }, { value: 'Actualizado', label: 'Actualizado' }, { value: 'Desactualizado', label: 'Desactualizado' }, { value: 'Error', label: 'Error' }, { value: 'Actualizando', label: 'Actualizando' }], []);

  useEffect(() => {
    if (!quotesUserId) {
      setQuotesBySecurityId(new Map());
      return;
    }

    setQuotesBySecurityId(readHoldingQuotesCache(quotesUserId));
  }, [quotesUserId]);

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
          ticker: security.ticker,
          exchangeCode: security.exchange_code,
          tickerLabel: formatSecurityLabel(security),
          companyName: security.company_name,
          quantityLabel: formatQuantity(holding.availableQuantity),
          quantityValue: holding.availableQuantity,
          remainingUnitCostLabel: formatCurrencyTotal(holding.remainingUnitCostMxn),
          remainingFifoCostBasisLabel: formatCurrencyTotal(holding.remainingFifoCostBasisMxn),
          portfolioWeightLabel: formatPercent(
            totalRemainingFifoCostBasis > 0 ? holding.remainingFifoCostBasisMxn / totalRemainingFifoCostBasis : null,
          ),
          portfolioWeightValue: totalRemainingFifoCostBasis > 0 ? holding.remainingFifoCostBasisMxn / totalRemainingFifoCostBasis : null,
          remainingFifoCostBasisValue: holding.remainingFifoCostBasisMxn,
          ...deriveQuotePresentation(null, null, false),
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

  useEffect(() => {
    setRows((currentRows) => {
      const nextRows = currentRows.map((row) => {
        const quote = quotesBySecurityId.get(row.securityId) ?? null;
        const errorMessage = quoteErrorsBySecurityId.get(row.securityId) ?? null;
        const isRefreshingQuote = refreshingSecurityIds.has(row.securityId);

        return {
          ...row,
          ...deriveQuotePresentation(quote, errorMessage, isRefreshingQuote),
        };
      });
      const totalMarketValueMxn = nextRows.reduce((sum, row) => sum + (row.currentPriceMxn != null ? row.currentPriceMxn * row.quantityValue : 0), 0);

      return nextRows.map((row) => {
        const marketValueMxn = row.currentPriceMxn != null ? Number((row.currentPriceMxn * row.quantityValue).toFixed(6)) : null;
        const marketWeightValue = marketValueMxn != null && totalMarketValueMxn > 0 ? Number((marketValueMxn / totalMarketValueMxn).toFixed(6)) : null;
        const unrealizedPnlMxn = marketValueMxn != null ? Number((marketValueMxn - row.remainingFifoCostBasisValue).toFixed(6)) : null;
        const unrealizedPnlPct = unrealizedPnlMxn != null && row.remainingFifoCostBasisValue > 0 ? Number((unrealizedPnlMxn / row.remainingFifoCostBasisValue).toFixed(6)) : null;

        return {
          ...row,
          marketWeightValue,
          marketWeightLabel: formatPercentage(marketWeightValue),
          unrealizedPnlMxn,
          unrealizedPnlMxnLabel: unrealizedPnlMxn != null ? formatCurrencyTotal(unrealizedPnlMxn) : '—',
          unrealizedPnlPct,
          unrealizedPnlPctLabel: formatPercentage(unrealizedPnlPct),
        };
      });
    });
  }, [quotesBySecurityId, quoteErrorsBySecurityId, refreshingSecurityIds]);

  const applyQuoteResponse = useCallback(
    (quotes: HoldingQuote[], errors: Array<{ securityId: string; message: string }>) => {
      setQuotesBySecurityId((currentQuotes) => {
        const nextQuotes = mergeHoldingQuotesCache(currentQuotes, quotes);

        if (quotesUserId) {
          writeHoldingQuotesCache(quotesUserId, nextQuotes);
        }

        return nextQuotes;
      });

      setQuoteErrorsBySecurityId((currentErrors) => {
        const nextErrors = new Map(currentErrors);

        for (const quote of quotes) {
          nextErrors.delete(quote.securityId);
        }

        for (const error of errors) {
          nextErrors.set(error.securityId, error.message);
        }

        return nextErrors;
      });
    },
    [quotesUserId],
  );

  const refreshQuotes = useCallback(
    async (items: QuoteRequestItem[]) => {
      if (items.length === 0) {
        setFeedback('No hay posiciones abiertas para actualizar precios.');
        return;
      }

      setRefreshingSecurityIds((currentIds) => new Set([...currentIds, ...items.map((item) => item.securityId)]));

      try {
        const result = await requestHoldingQuotes(items);
        applyQuoteResponse(result.quotes, result.errors);

        if (result.errors.length > 0 && result.quotes.length > 0) {
          setFeedback(`Se actualizaron ${result.quotes.length} precios. ${result.errors.length} ticker(s) quedaron con error.`);
        } else if (result.errors.length > 0) {
          setFeedback(result.errors[0]?.message ?? 'No fue posible actualizar los precios.');
        } else {
          setFeedback(items.length === 1 ? 'Precio actualizado.' : `Se actualizaron ${result.quotes.length} precios.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No fue posible actualizar los precios.';
        setQuoteErrorsBySecurityId((currentErrors) => {
          const nextErrors = new Map(currentErrors);

          for (const item of items) {
            nextErrors.set(item.securityId, message);
          }

          return nextErrors;
        });
        setFeedback(`No fue posible actualizar los precios: ${message}`);
      } finally {
        setRefreshingSecurityIds((currentIds) => {
          const nextIds = new Set(currentIds);

          for (const item of items) {
            nextIds.delete(item.securityId);
          }

          return nextIds;
        });
      }
    },
    [applyQuoteResponse],
  );

  const handleRefreshAllQuotes = useCallback(async () => {
    setIsRefreshingAllQuotes(true);

    try {
      await refreshQuotes(rows.map(buildQuoteRequestItem));
    } finally {
      setIsRefreshingAllQuotes(false);
    }
  }, [refreshQuotes, rows]);

  const handleRefreshSingleQuote = useCallback(
    async (row: HoldingRow) => {
      await refreshQuotes([buildQuoteRequestItem(row)]);
    },
    [refreshQuotes],
  );

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

  const renderCurrencyHeaderCell = useCallback(
    (_props: RenderHeaderCellProps<HoldingRow>) => (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Moneda</div>
        <AppSelect compact ariaLabel="Filtrar posiciones por moneda" options={currencyFilterOptions} value={currencyFilter} placeholder="Todas" onChange={setCurrencyFilter} />
      </div>
    ),
    [currencyFilter, currencyFilterOptions],
  );

  const renderProviderHeaderCell = useCallback(
    (_props: RenderHeaderCellProps<HoldingRow>) => (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Proveedor</div>
        <AppSelect compact ariaLabel="Filtrar posiciones por proveedor" options={providerFilterOptions} value={providerFilter} placeholder="Todos" onChange={setProviderFilter} />
      </div>
    ),
    [providerFilter, providerFilterOptions],
  );

  const renderStatusHeaderCell = useCallback(
    (_props: RenderHeaderCellProps<HoldingRow>) => (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Estado</div>
        <AppSelect compact ariaLabel="Filtrar posiciones por estado" options={statusFilterOptions} value={statusFilter} placeholder="Todos" onChange={setStatusFilter} />
      </div>
    ),
    [statusFilter, statusFilterOptions],
  );

  const columnsByKey = useMemo<Record<HoldingColumnKey, Column<HoldingRow>>>(() => {
    return {
      actions: {
        key: 'actions',
        name: '',
        width: ACTION_COLUMN_WIDTH,
        frozen: true,
        editable: false,
        renderCell: ({ row }) => {
          const isRefreshingQuote = row.isRefreshingQuote;
          const disabled = isRefreshingQuote || isRefreshingAllQuotes;

          return (
            <div className="grid-actions ticket-grid-actions grid-actions--1">
              <button
                type="button"
                className="grid-action grid-action--save"
                title={isRefreshingQuote ? 'Actualizando precio' : 'Actualizar precio'}
                aria-label={isRefreshingQuote ? 'Actualizando precio' : 'Actualizar precio'}
                disabled={disabled}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleRefreshSingleQuote(row);
                }}
              >
                <FontAwesomeIcon icon={faArrowsRotate} spin={isRefreshingQuote} />
              </button>
            </div>
          );
        },
      },
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
        renderCell: ({ row }) => <strong>{row.remainingUnitCostLabel}</strong>,
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
      marketWeightValue: {
        key: 'marketWeightValue',
        name: 'Peso act.',
        width: 100,
        sortable: true,
        renderCell: ({ row }) => row.marketWeightLabel,
      },
      unrealizedPnlMxn: {
        key: 'unrealizedPnlMxn',
        name: 'P/M MXN',
        width: 118,
        sortable: true,
        renderCell: ({ row }) => {
          const toneClass = getSignedToneClass(row.unrealizedPnlMxn);
          return toneClass ? <span className={toneClass}>{row.unrealizedPnlMxnLabel}</span> : row.unrealizedPnlMxnLabel;
        },
      },
      unrealizedPnlPct: {
        key: 'unrealizedPnlPct',
        name: 'P/M %',
        width: 94,
        sortable: true,
        renderCell: ({ row }) => {
          const toneClass = getSignedToneClass(row.unrealizedPnlPct);
          return toneClass ? <span className={toneClass}>{row.unrealizedPnlPctLabel}</span> : row.unrealizedPnlPctLabel;
        },
      },
      currentPrice: {
        key: 'currentPrice',
        name: 'Último',
        width: 110,
        sortable: true,
        renderCell: ({ row }) => row.currentPriceLabel,
      },
      sourceCurrencyCode: {
        key: 'sourceCurrencyCode',
        name: 'Moneda',
        width: 88,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderCurrencyHeaderCell,
        renderCell: ({ row }) => row.sourceCurrencyCode ?? '—',
      },
      currentPriceMxn: {
        key: 'currentPriceMxn',
        name: 'Último MXN',
        width: 124,
        sortable: true,
        renderCell: ({ row }) => <strong>{row.currentPriceMxnLabel}</strong>,
      },
      changeAmountMxn: {
        key: 'changeAmountMxn',
        name: 'Cambio MXN',
        width: 124,
        sortable: true,
        renderCell: ({ row }) => {
          const toneClass = getSignedToneClass(row.changeAmountMxn);
          return toneClass ? <span className={toneClass}>{row.changeAmountMxnLabel}</span> : row.changeAmountMxnLabel;
        },
      },
      changePercent: {
        key: 'changePercent',
        name: 'Cambio %',
        width: 100,
        sortable: true,
        renderCell: ({ row }) => {
          const toneClass = getSignedToneClass(row.changePercent);
          return toneClass ? <span className={toneClass}>{row.changePercentLabel}</span> : row.changePercentLabel;
        },
      },
      dayRangeMxn: {
        key: 'dayRangeMxn',
        name: 'Mín / Máx MXN',
        width: 164,
        renderCell: ({ row }) => row.dayRangeMxnLabel,
      },
      priceTimestamp: {
        key: 'priceTimestamp',
        name: 'Fecha',
        width: 148,
        renderCell: ({ row }) => row.priceTimestampLabel,
      },
      providerId: {
        key: 'providerId',
        name: 'Proveedor',
        width: 110,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderProviderHeaderCell,
        renderCell: ({ row }) => row.providerLabel,
      },
      quoteStatus: {
        key: 'quoteStatus',
        name: 'Estado',
        width: 118,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderStatusHeaderCell,
        renderCell: ({ row }) => (
          <span
            title={row.quoteError ?? row.quoteStatusLabel}
            className={
              row.quoteStatus === 'Error'
                ? 'status-pill status-pill--error'
                : row.quoteStatus === 'Desactualizado'
                  ? 'status-pill status-pill--idle'
                  : row.quoteStatus === 'Actualizando'
                    ? 'status-pill status-pill--checking'
                    : 'status-pill status-pill--ok'
            }
          >
            {row.quoteStatusLabel}
          </span>
        ),
      },
    };
  }, [handleRefreshSingleQuote, isRefreshingAllQuotes, renderCurrencyHeaderCell, renderProviderHeaderCell, renderStatusHeaderCell, renderTickerHeaderCell]);

  const columns = useMemo<readonly Column<HoldingRow>[]>(() => columnOrder.map((key) => columnsByKey[key]), [columnOrder, columnsByKey]);

  const filteredRows = useMemo(() => {
    const normalizedFilter = tickerFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesTicker = !normalizedFilter || row.tickerLabel.toLowerCase().includes(normalizedFilter) || row.companyName.toLowerCase().includes(normalizedFilter);
      const matchesCurrency = !currencyFilter || row.sourceCurrencyCode === currencyFilter;
      const matchesProvider = !providerFilter || row.providerId === providerFilter;
      const matchesStatus = !statusFilter || row.quoteStatus === statusFilter;

      return matchesTicker && matchesCurrency && matchesProvider && matchesStatus;
    });
  }, [currencyFilter, providerFilter, rows, statusFilter, tickerFilter]);

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
          continue;
        }

        if (sort.columnKey === 'marketWeightValue') {
          const result = compareNullableNumber(left.marketWeightValue, right.marketWeightValue);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'unrealizedPnlMxn') {
          const result = compareNullableNumber(left.unrealizedPnlMxn, right.unrealizedPnlMxn);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'unrealizedPnlPct') {
          const result = compareNullableNumber(left.unrealizedPnlPct, right.unrealizedPnlPct);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'currentPrice') {
          const result = compareNullableNumber(left.currentPrice, right.currentPrice);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'currentPriceMxn') {
          const result = compareNullableNumber(left.currentPriceMxn, right.currentPriceMxn);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'changePercent') {
          const result = compareNullableNumber(left.changePercent, right.changePercent);
          if (result !== 0) {
            return result * direction;
          }
          continue;
        }

        if (sort.columnKey === 'changeAmountMxn') {
          const result = compareNullableNumber(left.changeAmountMxn, right.changeAmountMxn);
          if (result !== 0) {
            return result * direction;
          }
        }
      }

      return 0;
    });
  }, [filteredRows, sortColumns]);

  const summary = useMemo(() => {
    const currentPortfolioValue = filteredRows.reduce((sum, row) => sum + (row.currentPriceMxn != null ? row.currentPriceMxn * row.quantityValue : 0), 0);

    return {
      count: filteredRows.length,
      totalFifoLabel: formatCurrencyTotal(filteredRows.reduce((sum, row) => sum + row.remainingFifoCostBasisValue, 0)),
      currentPortfolioValueLabel: formatCurrencyTotal(currentPortfolioValue),
      pricedCount: filteredRows.filter((row) => row.currentPrice != null).length,
    };
  }, [filteredRows]);

  return (
    <div className="page">
      <section className="card finance-panel">
        <div className="income-toolbar">
          <div className="income-toolbar__controls">
            <PeriodFilter ariaLabel="Filtrar posiciones por fecha" value={dateFilter} onChange={setDateFilter} disabled={isLoading} />
            <button type="button" className="tickets-button tickets-button--primary" onClick={() => void handleRefreshAllQuotes()} disabled={isLoading || isRefreshingAllQuotes || rows.length === 0}>
              <FontAwesomeIcon icon={faArrowsRotate} spin={isRefreshingAllQuotes} />
              <span>Actualizar precios</span>
            </button>
          </div>

          <div className="badge-row" aria-label="Resumen de posiciones visibles">
            <span className="badge">{summary.count} posiciones</span>
            <span className="badge">{summary.totalFifoLabel}</span>
            <span className="badge">Valor actual {summary.currentPortfolioValueLabel}</span>
            <span className="badge">{summary.pricedCount} con precio</span>
          </div>
        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}

        {rows.length > 0 ? (
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
