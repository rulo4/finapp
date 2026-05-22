import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type RenderHeaderCellProps, type SortColumn } from 'react-data-grid';
import { AppDatePicker } from '../shared/AppDatePicker';
import {
  AppSelect,
  FX_AUTO_SWITCH_FEEDBACK,
  InputCellEditor,
  SelectCellEditor,
  autoSwitchCurrencyFromFx,
  type SelectOption,
} from '../shared/gridEditors';
import { GridEditorNavigationProvider, moveToNextEditableGridCell } from '../shared/gridNavigation';
import { isIsoDateString } from '../shared/isoDate';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import {
  type Broker,
  createCurrentInvestmentDateFilter,
  type InvestmentDateFilter,
  type Security,
  commitActiveEditorAndRun,
  createLocalId,
  formatCurrencyTotal,
  formatEditableNumber,
  formatQuantityTotal,
  formatPercentage,
  formatSecurityLabel,
  formatSecurityOptionLabel,
  getDateRange,
  getTodayDate,
  investmentCurrencyOptions,
  isDateWithinRange,
  isErrorFeedback,
} from './shared';
import { PeriodFilter } from '../shared/PeriodFilter';
import {
  calculateHoldingPeriodYears,
  calculateRealizedCagr,
  previewFifoSell,
  summarizeBuyConsumption,
  type FifoSellPreview,
  type StockBuyMovement,
  type StockSellMovement,
} from './positionMetrics';

type TradeKind = 'buy' | 'sell';

type TradeDbRow = {
  id: string;
  created_at: string;
  trade_date: string;
  broker_id: string;
  security_id: string;
  currency_code: 'MXN' | 'USD';
  quantity: number;
  unit_price_original: number;
  fees_original: number | null;
  fx_rate_to_mxn: number | null;
  total_amount_mxn: number;
  notes: string | null;
  sell_group_id?: string | null;
  stock_buy_id?: string | null;
  quantity_held_before_sell?: number | null;
  fifo_cost_basis_mxn?: number | null;
  fifo_realized_pnl_mxn?: number | null;
};

type TradeGridRow = {
  id: string;
  persistedId: string | null;
  createdAt: string | null;
  isFeeManual: boolean;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  tradeDate: string;
  brokerId: string;
  securityId: string;
  currencyCode: 'MXN' | 'USD';
  quantity: string;
  unitPriceOriginal: string;
  feesOriginal: string;
  fxRateToMxn: string;
  totalAmountMxn: string;
  notes: string;
  sellGroupId: string | null;
  stockBuyId: string | null;
  quantityHeldBeforeSell: string;
  fifoCostBasisMxn: string;
  fifoRealizedPnlMxn: string;
};

type BuyHistoryRow = {
  id: string;
  broker_id: string;
  security_id: string;
  trade_date: string;
  quantity: number;
  unit_price_original: number;
  total_amount_mxn: number;
  created_at: string;
};

type SellHistoryRow = {
  id: string;
  broker_id: string;
  security_id: string;
  trade_date: string;
  quantity: number;
  total_amount_mxn: number;
  created_at: string;
  stock_buy_id: string | null;
  sell_group_id: string | null;
  fifo_cost_basis_mxn: number | null;
};

const GRID_ROW_HEIGHT = 30;
const FILTER_HEADER_ROW_HEIGHT = 64;
const DEFAULT_COLUMN_WIDTH = 108;
const AMOUNT_COLUMN_WIDTH = 92;
const ACTION_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 160;
const SELL_SORTABLE_COLUMN_KEYS = new Set(['fifoRealizedPnlMxn', 'fifoRealizedPnlPct', 'holdingPeriodYears', 'fifoRealizedCagr']);
const POSITION_EPSILON = 0.0000001;
const LOCKED_BUY_FEEDBACK = 'Las compras usadas en ventas FIFO no se pueden modificar ni eliminar.';

function createDraftTradeRow(): TradeGridRow {
  return {
    id: createLocalId('trade-draft'),
    persistedId: null,
    createdAt: null,
    isFeeManual: false,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    tradeDate: getTodayDate(),
    brokerId: '',
    securityId: '',
    currencyCode: 'MXN',
    quantity: '',
    unitPriceOriginal: '',
    feesOriginal: '0',
    fxRateToMxn: '1',
    totalAmountMxn: '',
    notes: '',
    sellGroupId: null,
    stockBuyId: null,
    quantityHeldBeforeSell: '',
    fifoCostBasisMxn: '',
    fifoRealizedPnlMxn: '',
  };
}

function getBrokerDefaultFeeFactor(row: TradeGridRow, brokerById: Map<string, Broker>) {
  const defaultFeeFactor = brokerById.get(row.brokerId)?.default_fee_factor;

  return defaultFeeFactor != null && Number.isFinite(defaultFeeFactor) && defaultFeeFactor >= 0 ? defaultFeeFactor : 0;
}

function applyDefaultTradeFee(row: TradeGridRow, brokerById: Map<string, Broker>) {
  const quantity = Number(row.quantity);
  const unitPrice = Number(row.unitPriceOriginal);

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return {
      ...row,
      feesOriginal: '0',
    };
  }

  const fees = quantity * unitPrice * getBrokerDefaultFeeFactor(row, brokerById);
  return {
    ...row,
    feesOriginal: formatEditableNumber(Number(fees.toFixed(6))) || '0',
  };
}

function withDraftRow(rows: TradeGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftTradeRow();

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function normalizeTradeGridRow(row: TradeGridRow, kind: TradeKind): TradeGridRow {
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn.trim();
  const quantity = Number(row.quantity);
  const unitPrice = Number(row.unitPriceOriginal);
  const fees = Number(row.feesOriginal || '0');
  const fxRate = Number(fxRateToMxn);
  const grossOriginal = quantity * unitPrice;
  const totalOriginal = kind === 'buy' ? grossOriginal + fees : grossOriginal - fees;

  return {
    ...row,
    fxRateToMxn,
    feesOriginal: row.feesOriginal.trim() ? row.feesOriginal : '0',
    totalAmountMxn:
      Number.isFinite(totalOriginal) && totalOriginal >= 0 && Number.isFinite(fxRate) && fxRate > 0
        ? formatEditableNumber(Number((totalOriginal * fxRate).toFixed(6)))
        : '',
  };
}

function canSaveDraftTradeRow(row: TradeGridRow) {
  return Boolean(
    row.tradeDate.trim() &&
      row.brokerId &&
      row.securityId &&
      row.quantity.trim() &&
      row.unitPriceOriginal.trim() &&
      (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()),
  );
}

function formatTradeIssuesMessage(row: TradeGridRow) {
  const issues: string[] = [];

  if (!row.tradeDate.trim()) issues.push('captura la fecha');
  if (!row.securityId) issues.push('selecciona el ticker');
  if (!row.brokerId) issues.push('selecciona el broker');
  if (!row.quantity.trim()) issues.push('captura la cantidad');
  if (!row.unitPriceOriginal.trim()) issues.push('captura el precio');
  if (row.currencyCode !== 'MXN' && !row.fxRateToMxn.trim()) issues.push('captura el tipo de cambio');

  return issues.length > 0 ? `No se puede guardar la fila: ${issues.join(', ')}.` : 'Revisa la fila.';
}

function validateTradeRow(row: TradeGridRow, kind: TradeKind) {
  if (!row.tradeDate || !isIsoDateString(row.tradeDate)) {
    return 'usa una fecha válida en formato AAAA-MM-DD';
  }

  if (!row.securityId) {
    return 'selecciona un ticker';
  }

  if (!row.brokerId) {
    return 'selecciona un broker';
  }

  const quantity = Number(row.quantity);
  if (!row.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    return 'usa una cantidad mayor a cero';
  }

  const unitPrice = Number(row.unitPriceOriginal);
  if (!row.unitPriceOriginal.trim() || !Number.isFinite(unitPrice) || unitPrice <= 0) {
    return 'usa un precio mayor a cero';
  }

  const fees = Number(row.feesOriginal || '0');
  if (!Number.isFinite(fees) || fees < 0) {
    return 'usa una comisión válida';
  }

  const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return 'usa un tipo de cambio mayor a cero';
  }

  const grossOriginal = quantity * unitPrice;
  const totalOriginal = kind === 'buy' ? grossOriginal + fees : grossOriginal - fees;
  if (totalOriginal <= 0) {
    return kind === 'buy' ? 'el total de la compra debe ser mayor a cero' : 'la venta neta debe ser mayor a cero';
  }

  return null;
}

function toTradeGridRow(row: TradeDbRow): TradeGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    createdAt: row.created_at,
    isFeeManual: true,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    tradeDate: row.trade_date,
    brokerId: row.broker_id,
    securityId: row.security_id,
    currencyCode: row.currency_code,
    quantity: formatEditableNumber(row.quantity),
    unitPriceOriginal: formatEditableNumber(row.unit_price_original),
    feesOriginal: formatEditableNumber(row.fees_original ?? 0),
    fxRateToMxn: formatEditableNumber(row.currency_code === 'MXN' ? 1 : (row.fx_rate_to_mxn ?? 1)),
    totalAmountMxn: formatEditableNumber(row.total_amount_mxn),
    notes: row.notes ?? '',
    sellGroupId: row.sell_group_id ?? null,
    stockBuyId: row.stock_buy_id ?? null,
    quantityHeldBeforeSell: formatEditableNumber(row.quantity_held_before_sell),
    fifoCostBasisMxn: formatEditableNumber(row.fifo_cost_basis_mxn),
    fifoRealizedPnlMxn: formatEditableNumber(row.fifo_realized_pnl_mxn),
  };
}

function compareRowsByRecency(left: TradeGridRow, right: TradeGridRow) {
  if (left.tradeDate !== right.tradeDate) {
    return right.tradeDate.localeCompare(left.tradeDate);
  }

  const leftCreatedAt = left.createdAt ?? '';
  const rightCreatedAt = right.createdAt ?? '';
  if (leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt.localeCompare(leftCreatedAt);
  }

  return right.id.localeCompare(left.id);
}

function parseEditableNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function compareSellRowsForDisplay(left: TradeGridRow, right: TradeGridRow, buyById: Map<string, StockBuyMovement>) {
  if (left.tradeDate !== right.tradeDate) {
    return right.tradeDate.localeCompare(left.tradeDate);
  }

  if (left.sellGroupId && left.sellGroupId === right.sellGroupId) {
    const leftAvailableBeforeSell = parseEditableNumber(left.quantityHeldBeforeSell);
    const rightAvailableBeforeSell = parseEditableNumber(right.quantityHeldBeforeSell);
    if (leftAvailableBeforeSell != null && rightAvailableBeforeSell != null && leftAvailableBeforeSell !== rightAvailableBeforeSell) {
      return leftAvailableBeforeSell - rightAvailableBeforeSell;
    }
  }

  const leftBuy = left.stockBuyId ? buyById.get(left.stockBuyId) : null;
  const rightBuy = right.stockBuyId ? buyById.get(right.stockBuyId) : null;
  if (leftBuy && rightBuy) {
    if (leftBuy.tradeDate !== rightBuy.tradeDate) {
      return rightBuy.tradeDate.localeCompare(leftBuy.tradeDate);
    }

    const leftBuyCreatedAt = leftBuy.createdAt ?? '';
    const rightBuyCreatedAt = rightBuy.createdAt ?? '';
    if (leftBuyCreatedAt !== rightBuyCreatedAt) {
      return rightBuyCreatedAt.localeCompare(leftBuyCreatedAt);
    }

    return rightBuy.id.localeCompare(leftBuy.id);
  }

  return compareRowsByRecency(left, right);
}

function getPnlToneClass(value: number | null) {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return 'trade-cell-value';
  }

  return value > 0 ? 'trade-cell-value trade-cell-value--positive' : 'trade-cell-value trade-cell-value--negative';
}

function getDraftPreviewNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function formatHoldingPeriodYears(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

function getSellRowRealizedPnl(row: TradeGridRow, draftSellPreview: FifoSellPreview | null) {
  return row.isDraft ? getDraftPreviewNumber(draftSellPreview?.fifoRealizedPnlMxn) : parseEditableNumber(row.fifoRealizedPnlMxn);
}

function getSellRowRealizedPnlPct(row: TradeGridRow, draftSellPreview: FifoSellPreview | null) {
  if (row.isDraft) {
    return getDraftPreviewNumber(draftSellPreview?.fifoRealizedPnlPct);
  }

  const pnl = parseEditableNumber(row.fifoRealizedPnlMxn);
  const basis = parseEditableNumber(row.fifoCostBasisMxn);
  return pnl != null && basis != null && basis !== 0 ? pnl / basis : null;
}

function getSellRowHoldingPeriodYears(
  row: TradeGridRow,
  draftSellPreview: FifoSellPreview | null,
  buyById: Map<string, StockBuyMovement>,
) {
  if (row.isDraft) {
    return getDraftPreviewNumber(draftSellPreview?.holdingPeriodYears);
  }

  if (!row.stockBuyId) {
    return null;
  }

  const buyTradeDate = buyById.get(row.stockBuyId)?.tradeDate;
  return buyTradeDate ? calculateHoldingPeriodYears(buyTradeDate, row.tradeDate) : null;
}

function getSellRowRealizedCagr(
  row: TradeGridRow,
  draftSellPreview: FifoSellPreview | null,
  buyById: Map<string, StockBuyMovement>,
) {
  if (row.isDraft) {
    return getDraftPreviewNumber(draftSellPreview?.fifoRealizedCagr);
  }

  if (!row.stockBuyId) {
    return null;
  }

  const buyTradeDate = buyById.get(row.stockBuyId)?.tradeDate;
  const basis = parseEditableNumber(row.fifoCostBasisMxn);
  const totalAmount = parseEditableNumber(row.totalAmountMxn);
  if (!buyTradeDate || basis == null || totalAmount == null) {
    return null;
  }

  return calculateRealizedCagr(buyTradeDate, row.tradeDate, basis, totalAmount);
}

function createSellGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return createLocalId('sell-group');
}

export function StockTradesPage({ kind }: { kind: TradeKind }) {
  const tableName = kind === 'buy' ? 'stock_buys' : 'stock_sells';
  const panelTitle = kind === 'buy' ? 'Compras de acciones' : 'Ventas de acciones';
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [rows, setRows] = useState<TradeGridRow[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [tickerFilter, setTickerFilter] = useState('');
  const [dateColumnFilter, setDateColumnFilter] = useState('');
  const [brokerFilterId, setBrokerFilterId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<InvestmentDateFilter>(() => createCurrentInvestmentDateFilter());
  const [buyHistory, setBuyHistory] = useState<StockBuyMovement[]>([]);
  const [sellHistory, setSellHistory] = useState<StockSellMovement[]>([]);
  const rowsRef = useRef<TradeGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, TradeGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const activeDateRange = useMemo(() => getDateRange(dateFilter), [dateFilter]);

  const loadData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no está configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    let entriesQuery = kind === 'sell'
      ? supabase
          .from(tableName)
          .select('id, created_at, trade_date, broker_id, security_id, currency_code, quantity, unit_price_original, fees_original, fx_rate_to_mxn, total_amount_mxn, notes, sell_group_id, stock_buy_id, quantity_held_before_sell, fifo_cost_basis_mxn, fifo_realized_pnl_mxn')
          .order('trade_date', { ascending: false })
          .order('created_at', { ascending: false })
      : supabase
          .from(tableName)
          .select('id, created_at, trade_date, broker_id, security_id, currency_code, quantity, unit_price_original, fees_original, fx_rate_to_mxn, total_amount_mxn, notes')
          .order('trade_date', { ascending: false })
          .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('trade_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('trade_date', activeDateRange.end);
    }

    const [
      { data: brokerData, error: brokerError },
      { data: securityData, error: securityError },
      { data: entryData, error: entryError },
      { data: buyHistoryData, error: buyHistoryError },
      { data: sellHistoryData, error: sellHistoryError },
    ] = await Promise.all([
      supabase.from('brokers').select('id, name, default_fee_factor').eq('is_active', true).order('name', { ascending: true }),
      supabase.from('securities').select('id, ticker, company_name, exchange_code, is_active').order('ticker', { ascending: true }),
      entriesQuery,
      kind === 'sell'
        ? supabase.from('stock_buys').select('id, broker_id, security_id, trade_date, quantity, unit_price_original, total_amount_mxn, created_at')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('stock_sells').select('id, broker_id, security_id, trade_date, quantity, total_amount_mxn, created_at, stock_buy_id, sell_group_id, fifo_cost_basis_mxn'),
    ]);

    if (brokerError) {
      setFeedback(`No fue posible cargar brokers: ${brokerError.message}`);
      setIsLoading(false);
      return;
    }

    if (entryError) {
      setFeedback(`No fue posible cargar ${panelTitle.toLowerCase()}: ${entryError.message}`);
      setIsLoading(false);
      return;
    }

    if (securityError) {
      setFeedback(`No fue posible cargar valores bursátiles: ${securityError.message}`);
      setIsLoading(false);
      return;
    }

    if (buyHistoryError || sellHistoryError) {
      setFeedback(`No fue posible cargar el historial para calcular ventas: ${buyHistoryError?.message ?? sellHistoryError?.message}`);
      setIsLoading(false);
      return;
    }

    const nextBrokers = (brokerData as Broker[]) ?? [];
    const nextSecurities = (securityData as Security[]) ?? [];
    const nextBuyHistory = (((buyHistoryData as BuyHistoryRow[]) ?? []).map((row) => ({
      id: row.id,
      brokerId: row.broker_id,
      securityId: row.security_id,
      tradeDate: row.trade_date,
      quantity: Number(row.quantity),
      unitPriceOriginal: Number(row.unit_price_original),
      totalAmountMxn: Number(row.total_amount_mxn),
      createdAt: row.created_at,
    }))) satisfies StockBuyMovement[];
    const nextRows = ((entryData as TradeDbRow[]) ?? []).map(toTradeGridRow);
    const sortedRows = kind === 'sell'
      ? [...nextRows].sort((left, right) => compareSellRowsForDisplay(left, right, new Map(nextBuyHistory.map((buy) => [buy.id, buy]))))
      : [...nextRows].sort(compareRowsByRecency);
    const loadedRows = withDraftRow(sortedRows);

    persistedRowsRef.current = new Map(sortedRows.map((row) => [row.id, row]));
    rowsRef.current = loadedRows;
    setBrokers(nextBrokers);
    setSecurities(nextSecurities);
    setRows(loadedRows);
    setBuyHistory(nextBuyHistory);
    setSellHistory(
      (((sellHistoryData as SellHistoryRow[]) ?? []).map((row) => ({
        id: row.id,
        brokerId: row.broker_id,
        securityId: row.security_id,
        tradeDate: row.trade_date,
        quantity: Number(row.quantity),
        totalAmountMxn: Number(row.total_amount_mxn),
        createdAt: row.created_at,
        stockBuyId: row.stock_buy_id,
        sellGroupId: row.sell_group_id,
        fifoCostBasisMxn: row.fifo_cost_basis_mxn == null ? null : Number(row.fifo_cost_basis_mxn),
      }))) satisfies StockSellMovement[],
    );

    const missingDependencies: string[] = [];
    if (nextBrokers.length === 0) {
      missingDependencies.push('al menos un broker');
    }
    if (!nextSecurities.some((security) => security.is_active)) {
      missingDependencies.push('al menos un valor bursátil');
    }

    setFeedback(
      missingDependencies.length > 0 ? `Primero crea ${missingDependencies.join(' y ')} en Catálogos.` : null,
    );
    setIsLoading(false);
  }, [activeDateRange.end, activeDateRange.start, kind, panelTitle, tableName]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const buyRowsForMetrics = useMemo(() => {
    if (kind !== 'buy') {
      return [] satisfies StockBuyMovement[];
    }

    return rows
      .filter((row) => !row.isDraft && row.persistedId)
      .map((row) => ({
        id: row.persistedId ?? row.id,
        brokerId: row.brokerId,
        securityId: row.securityId,
        tradeDate: row.tradeDate,
        quantity: Number(row.quantity),
        unitPriceOriginal: Number(row.unitPriceOriginal),
        totalAmountMxn: Number(row.totalAmountMxn),
        createdAt: row.createdAt,
      }))
      .filter(
        (row) =>
          row.securityId &&
          row.tradeDate &&
          Number.isFinite(row.quantity) &&
          Number.isFinite(row.unitPriceOriginal) &&
          Number.isFinite(row.totalAmountMxn),
      ) satisfies StockBuyMovement[];
  }, [kind, rows]);

  const buyConsumptionById = useMemo(
    () => new Map(summarizeBuyConsumption(buyRowsForMetrics, sellHistory).map((summary) => [summary.buyId, summary])),
    [buyRowsForMetrics, sellHistory],
  );

  const isBuyRowLocked = useCallback(
    (row: TradeGridRow) => {
      if (kind !== 'buy' || row.isDraft) {
        return false;
      }

      const buyId = row.persistedId ?? row.id;
      return buyConsumptionById.get(buyId)?.isUsedInSell ?? false;
    },
    [buyConsumptionById, kind],
  );

  const isBuyRowClosed = useCallback(
    (row: TradeGridRow) => {
      if (kind !== 'buy' || row.isDraft) {
        return false;
      }

      const buyId = row.persistedId ?? row.id;
      return buyConsumptionById.get(buyId)?.isClosed ?? false;
    },
    [buyConsumptionById, kind],
  );

  function handleRowsChange(nextRows: TradeGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0] ?? null;

    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    if ((kind === 'sell' && !nextRows[rowIndex].isDraft) || isBuyRowLocked(nextRows[rowIndex])) {
      const restoredRow = persistedRowsRef.current.get(nextRows[rowIndex].id) ?? nextRows[rowIndex];
      const restoredRows = nextRows.map((row, index) => (index === rowIndex ? restoredRow : row));
      rowsRef.current = restoredRows;
      setRows(restoredRows);
      setFeedback(kind === 'sell' ? 'Las ventas guardadas se ajustan eliminando y capturando de nuevo el movimiento.' : LOCKED_BUY_FEEDBACK);
      return;
    }

    const previousRow = rowsRef.current[rowIndex] ?? nextRows[rowIndex];
    const currencyChanged = nextRows[rowIndex].currencyCode !== previousRow.currencyCode;
    const brokerChanged = nextRows[rowIndex].brokerId !== previousRow.brokerId;
    const quantityChanged = nextRows[rowIndex].quantity !== previousRow.quantity;
    const unitPriceChanged = nextRows[rowIndex].unitPriceOriginal !== previousRow.unitPriceOriginal;
    const feesChanged = nextRows[rowIndex].feesOriginal !== previousRow.feesOriginal;

    const autoSwitchedFxRow = autoSwitchCurrencyFromFx(nextRows[rowIndex]);
    const autoSwitchedCurrency = nextRows[rowIndex].currencyCode === 'MXN' && autoSwitchedFxRow.currencyCode === 'USD';

    let nextEditedRow: TradeGridRow = autoSwitchedFxRow;
    if (currencyChanged) {
      nextEditedRow = {
        ...nextEditedRow,
        fxRateToMxn: nextEditedRow.currencyCode === 'MXN' ? '1' : autoSwitchedCurrency ? nextEditedRow.fxRateToMxn : previousRow.currencyCode === 'MXN' ? '' : nextEditedRow.fxRateToMxn,
      };
    }

    const nextIsFeeManual = brokerChanged
      ? false
      : feesChanged && !quantityChanged && !unitPriceChanged
        ? true
        : previousRow.isFeeManual;

    nextEditedRow = {
      ...nextEditedRow,
      isFeeManual: nextIsFeeManual,
    };

    if (!nextIsFeeManual && (brokerChanged || quantityChanged || unitPriceChanged)) {
      nextEditedRow = applyDefaultTradeFee(nextEditedRow, brokerById);
    }

    const normalizedRow = normalizeTradeGridRow(nextEditedRow, kind);
    const shouldPersist = normalizedRow.isDraft ? canSaveDraftTradeRow(normalizedRow) : true;
    const validationMessage = shouldPersist ? validateTradeRow(normalizedRow, kind) : null;
    const updatedRows: TradeGridRow[] = nextRows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }

      return {
        ...normalizedRow,
        status: validationMessage ? 'error' : normalizedRow.isDraft ? 'new' : 'dirty',
        errorMessage: validationMessage,
      };
    });

    rowsRef.current = updatedRows;
    setRows(updatedRows);

    if (autoSwitchedCurrency) {
      setFeedback(FX_AUTO_SWITCH_FEEDBACK);
    }
  }

  const persistRow = useCallback(async (rowId: string) => {
    if (!supabase) {
      setFeedback('Supabase no está disponible para guardar movimientos.');
      return;
    }

    const row = rowsRef.current.find((candidate) => candidate.id === rowId);

    if (!row) {
      setFeedback('No se encontró la fila que intentas guardar. Intenta de nuevo.');
      return;
    }

    if (kind === 'sell' && !row.isDraft) {
      setFeedback('Las ventas guardadas se ajustan eliminando y capturando de nuevo el movimiento.');
      return;
    }

    if (isBuyRowLocked(row)) {
      setFeedback(LOCKED_BUY_FEEDBACK);
      return;
    }

    if (row.isDraft && !canSaveDraftTradeRow(row)) {
      const draftErrorMessage = formatTradeIssuesMessage(row);
      setRows((currentRows) => {
        const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(draftErrorMessage);
      return;
    }

    const validationMessage = validateTradeRow(row, kind);
    if (validationMessage) {
      setRows((currentRows) => {
        const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(validationMessage);
      return;
    }

    setRows((currentRows) => {
      const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
      );
      rowsRef.current = nextRows;
      return nextRows;
    });

    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPriceOriginal);
    const fees = Number(row.feesOriginal || '0');
    const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
    const grossOriginal = quantity * unitPrice;
    const totalOriginal = kind === 'buy' ? grossOriginal + fees : grossOriginal - fees;
    const payload = {
      trade_date: row.tradeDate,
      broker_id: row.brokerId,
      security_id: row.securityId,
      currency_code: row.currencyCode,
      quantity: Number(quantity.toFixed(6)),
      unit_price_original: Number(unitPrice.toFixed(6)),
      fees_original: Number(fees.toFixed(6)),
      fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : Number(fxRateToMxn.toFixed(6)),
      total_amount_mxn: Number((totalOriginal * fxRateToMxn).toFixed(6)),
      notes: row.notes.trim() || null,
    };

    if (kind === 'sell') {
      const sellPreview = previewFifoSell(buyHistory, sellHistory, {
        id: row.persistedId ?? row.id,
        brokerId: row.brokerId,
        securityId: row.securityId,
        tradeDate: row.tradeDate,
        quantity,
        unitPriceOriginal: unitPrice,
        feesOriginal: fees,
        fxRateToMxn,
        totalAmountMxn: Number((totalOriginal * fxRateToMxn).toFixed(6)),
        createdAt: row.createdAt,
      });

      if (!sellPreview) {
        setFeedback('No fue posible calcular métricas previas para la venta.');
        return;
      }

      if (sellPreview.errorMessage) {
        setRows((currentRows) => {
          const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: sellPreview.errorMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(sellPreview.errorMessage);
        return;
      }

      if (sellPreview.matches.length === 0) {
        setFeedback('Completa la fila para generar los registros FIFO de la venta.');
        return;
      }

      const sellGroupId = createSellGroupId();
      const sellPayloads = sellPreview.matches.map((match) => ({
        ...payload,
        quantity: Number(match.quantityToSell.toFixed(6)),
        fees_original: Number(match.allocatedFeesOriginal.toFixed(6)),
        total_amount_mxn: Number(match.totalAmountMxn.toFixed(6)),
        sell_group_id: sellGroupId,
        stock_buy_id: match.stockBuyId,
        quantity_held_before_sell: Number(match.quantityAvailableBeforeSell.toFixed(6)),
        fifo_cost_basis_mxn: Number(match.fifoCostBasisMxn.toFixed(6)),
        fifo_realized_pnl_mxn: Number(match.fifoRealizedPnlMxn.toFixed(6)),
      }));

      const result = await supabase.from(tableName).insert(sellPayloads);
      if (result.error) {
        setRows((currentRows) => {
          const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(`No fue posible guardar el movimiento: ${result.error.message}`);
        return;
      }

      await loadData();
      setFeedback(`Venta guardada en ${sellPayloads.length} registros FIFO.`);
      return;
    }

    const result = row.isDraft
      ? await supabase.from(tableName).insert(payload).select('id').single()
      : await supabase.from(tableName).update(payload).eq('id', row.persistedId);

    if (result.error) {
      setRows((currentRows) => {
        const nextRows: TradeGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(`No fue posible guardar el movimiento: ${result.error.message}`);
      return;
    }

    const persistedId = row.isDraft ? result.data?.id ?? null : row.persistedId;
    if (!persistedId) {
      setFeedback('No se recibió el identificador del movimiento guardado.');
      return;
    }

    const savedRow: TradeGridRow = {
      ...normalizeTradeGridRow(row, kind),
      persistedId,
      createdAt: row.createdAt ?? new Date().toISOString(),
      isDraft: false,
      status: 'saved',
      errorMessage: null,
    };

    if (isDateWithinRange(savedRow.tradeDate, activeDateRange)) {
      persistedRowsRef.current.set(rowId, savedRow);
    } else {
      persistedRowsRef.current.delete(rowId);
    }

    setRows((currentRows) => {
      const nextRows = !isDateWithinRange(savedRow.tradeDate, activeDateRange)
        ? withDraftRow(currentRows.filter((candidate) => candidate.id !== rowId))
        : withDraftRow(currentRows.map((candidate) => (candidate.id === rowId ? savedRow : candidate)));
      rowsRef.current = nextRows;
      return nextRows;
    });

    setFeedback('Compra guardada.');
  }, [activeDateRange, buyHistory, isBuyRowLocked, kind, loadData, sellHistory, tableName]);

  const handleDeleteRow = useCallback(async (row: TradeGridRow) => {
    if (row.isDraft) {
      setRows((currentRows) => {
        const nextRows = withDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback('Fila de captura reiniciada.');
      return;
    }

    if (!supabase) {
      setFeedback('Supabase no está disponible para eliminar movimientos.');
      return;
    }

    if (isBuyRowLocked(row)) {
      setFeedback(LOCKED_BUY_FEEDBACK);
      return;
    }

    if (!window.confirm(kind === 'buy' ? 'Eliminar esta compra?' : 'Eliminar esta venta FIFO? Se eliminarán todos los lotes asociados.')) {
      return;
    }

    const deleteResult = kind === 'sell' && row.sellGroupId
      ? await supabase.from(tableName).delete().eq('sell_group_id', row.sellGroupId)
      : await supabase.from(tableName).delete().eq('id', row.persistedId);

    if (deleteResult.error) {
      setFeedback(`No fue posible eliminar el movimiento: ${deleteResult.error.message}`);
      return;
    }

    if (kind === 'sell') {
      await loadData();
      setFeedback('Venta eliminada.');
      return;
    }

    persistedRowsRef.current.delete(row.id);
    setRows((currentRows) => {
      const nextRows = withDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback('Compra eliminada.');
  }, [isBuyRowLocked, kind, loadData, tableName]);

  const handleRevertRow = useCallback((row: TradeGridRow) => {
    if (row.isDraft) {
      setRows((currentRows) => {
        const nextRows = withDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback('Fila de captura reiniciada.');
      return;
    }

    const persistedRow = persistedRowsRef.current.get(row.id);
    if (!persistedRow) {
      return;
    }

    setRows((currentRows) => {
      const nextRows = withDraftRow(currentRows.map((candidate) => (candidate.id === row.id ? persistedRow : candidate)));
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback('Se restauraron los últimos valores guardados.');
  }, []);

  const brokerOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Broker' }, ...brokers.map((broker) => ({ value: broker.id, label: broker.name }))],
    [brokers],
  );
  const brokerFilterOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Todos' }, ...brokers.map((broker) => ({ value: broker.id, label: broker.name }))],
    [brokers],
  );
  const brokerById = useMemo(() => new Map(brokers.map((broker) => [broker.id, broker])), [brokers]);
  const brokerLabelById = useMemo(() => new Map(brokers.map((broker) => [broker.id, broker.name])), [brokers]);
  const securityLabelById = useMemo(
    () => new Map(securities.map((security) => [security.id, formatSecurityLabel(security)])),
    [securities],
  );
  const securityOptions = useMemo<readonly SelectOption[]>(
    () => [
      { value: '', label: 'Ticker' },
      ...securities.map((security) => ({
        value: security.id,
        label: security.is_active ? formatSecurityOptionLabel(security) : `${formatSecurityOptionLabel(security)} [inactivo]`,
      })),
    ],
    [securities],
  );
  const buyById = useMemo(() => new Map(buyHistory.map((buy) => [buy.id, buy])), [buyHistory]);
  const filteredRows = useMemo(() => {
    const normalizedTickerFilter = tickerFilter.trim().toLowerCase();
    const normalizedDateFilter = dateColumnFilter.trim();
    const normalizedBrokerFilter = brokerFilterId.trim();

    if (!normalizedTickerFilter && !normalizedDateFilter && !normalizedBrokerFilter) {
      return rows;
    }

    return rows.filter((row) => {
      if (row.isDraft) {
        return true;
      }

      if (normalizedDateFilter && row.tradeDate !== normalizedDateFilter) {
        return false;
      }

      if (normalizedBrokerFilter && row.brokerId !== normalizedBrokerFilter) {
        return false;
      }

      const tickerLabel = securityLabelById.get(row.securityId)?.toLowerCase() ?? '';
      return !normalizedTickerFilter || tickerLabel.includes(normalizedTickerFilter);
    });
  }, [brokerFilterId, dateColumnFilter, rows, securityLabelById, tickerFilter]);
  const visibleSummary = useMemo(() => {
    const visibleRows = filteredRows.filter((row) => !row.isDraft);
    const totalAmount = visibleRows.reduce((sum, row) => {
      const rowTotal = Number(row.totalAmountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);
    const totalQuantity = visibleRows.reduce((sum, row) => {
      const rowQuantity = Number(row.quantity);

      return Number.isFinite(rowQuantity) ? sum + rowQuantity : sum;
    }, 0);
    const totalRealizedPnl = kind === 'sell'
      ? visibleRows.reduce((sum, row) => {
          const rowPnl = Number(row.fifoRealizedPnlMxn);

          return Number.isFinite(rowPnl) ? sum + rowPnl : sum;
        }, 0)
      : null;

    let activeQuantity = 0;
    let activeAmount = 0;
    let activeOpenCount = 0;
    let closedCount = 0;

    if (kind === 'buy') {
      for (const row of visibleRows) {
        const rowQuantity = Number(row.quantity);
        const rowTotalAmount = Number(row.totalAmountMxn);
        const consumption = buyConsumptionById.get(row.persistedId ?? row.id);
        const remainingQuantity = consumption?.remainingQuantity ?? (Number.isFinite(rowQuantity) ? rowQuantity : 0);
        const remainingAmount = consumption?.remainingFifoCostBasisMxn ?? (Number.isFinite(rowTotalAmount) ? rowTotalAmount : 0);

        activeQuantity += remainingQuantity > POSITION_EPSILON ? remainingQuantity : 0;
        activeAmount += remainingAmount > POSITION_EPSILON ? remainingAmount : 0;

        if (remainingQuantity > POSITION_EPSILON) {
          activeOpenCount += 1;
        } else {
          closedCount += 1;
        }
      }
    }

    return {
      count: visibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
      totalQuantityLabel: formatQuantityTotal(totalQuantity),
      totalRealizedPnl,
      activeQuantityLabel: kind === 'buy' ? formatQuantityTotal(activeQuantity) : null,
      activeTotalLabel: kind === 'buy' ? formatCurrencyTotal(activeAmount) : null,
      activeOpenCount: kind === 'buy' ? activeOpenCount : null,
      closedCount: kind === 'buy' ? closedCount : null,
      activeUnitCostLabel:
        kind === 'buy' ? (activeQuantity > POSITION_EPSILON ? formatCurrencyTotal(activeAmount / activeQuantity) : '-') : null,
    };
  }, [buyConsumptionById, filteredRows, kind]);
  const draftSellPreview = useMemo(() => {
    if (kind !== 'sell') {
      return null;
    }

    const draftRow = rows.find((row) => row.isDraft);
    if (!draftRow) {
      return null;
    }

    const quantity = draftRow.quantity.trim() ? Number(draftRow.quantity) : null;
    const unitPriceOriginal = draftRow.unitPriceOriginal.trim() ? Number(draftRow.unitPriceOriginal) : null;
    const feesOriginal = draftRow.feesOriginal.trim() ? Number(draftRow.feesOriginal) : 0;
    const fxRateToMxn = draftRow.currencyCode === 'MXN' ? 1 : draftRow.fxRateToMxn.trim() ? Number(draftRow.fxRateToMxn) : null;
    const totalAmountMxn = draftRow.totalAmountMxn.trim() ? Number(draftRow.totalAmountMxn) : null;

    return previewFifoSell(buyHistory, sellHistory, {
      id: draftRow.id,
      brokerId: draftRow.brokerId,
      securityId: draftRow.securityId,
      tradeDate: draftRow.tradeDate,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unitPriceOriginal: Number.isFinite(unitPriceOriginal) ? unitPriceOriginal : null,
      feesOriginal: Number.isFinite(feesOriginal) ? feesOriginal : null,
      fxRateToMxn: Number.isFinite(fxRateToMxn) ? fxRateToMxn : null,
      totalAmountMxn: Number.isFinite(totalAmountMxn) ? totalAmountMxn : null,
      createdAt: draftRow.createdAt,
    });
  }, [buyHistory, kind, rows, sellHistory]);
  const sortedRows = useMemo(() => {
    if (kind !== 'sell' || sortColumns.length === 0) {
      return filteredRows;
    }

    const draftRows = filteredRows.filter((row) => row.isDraft);
    const persistedRows = filteredRows.filter((row) => !row.isDraft);

    const sortedPersistedRows = [...persistedRows].sort((left, right) => {
      for (const sort of sortColumns) {
        const direction = sort.direction === 'ASC' ? 1 : -1;
        let result = 0;

        if (sort.columnKey === 'fifoRealizedPnlMxn') {
          result = compareNullableNumber(getSellRowRealizedPnl(left, draftSellPreview), getSellRowRealizedPnl(right, draftSellPreview));
        } else if (sort.columnKey === 'fifoRealizedPnlPct') {
          result = compareNullableNumber(getSellRowRealizedPnlPct(left, draftSellPreview), getSellRowRealizedPnlPct(right, draftSellPreview));
        } else if (sort.columnKey === 'holdingPeriodYears') {
          result = compareNullableNumber(
            getSellRowHoldingPeriodYears(left, draftSellPreview, buyById),
            getSellRowHoldingPeriodYears(right, draftSellPreview, buyById),
          );
        } else if (sort.columnKey === 'fifoRealizedCagr') {
          result = compareNullableNumber(
            getSellRowRealizedCagr(left, draftSellPreview, buyById),
            getSellRowRealizedCagr(right, draftSellPreview, buyById),
          );
        }

        if (result !== 0) {
          return result * direction;
        }
      }

      return compareSellRowsForDisplay(left, right, buyById);
    });

    return [...draftRows, ...sortedPersistedRows];
  }, [buyById, draftSellPreview, filteredRows, kind, sortColumns]);

  function renderTickerHeaderCell(props: RenderHeaderCellProps<TradeGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Ticker</div>
        <input
          type="text"
          className="grid-header-filter__input"
          value={tickerFilter}
          placeholder="Filtrar"
          tabIndex={props.tabIndex}
          aria-label={`Filtrar ${panelTitle.toLowerCase()} por ticker`}
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
    );
  }

  function renderDateHeaderCell(props: RenderHeaderCellProps<TradeGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Fecha</div>
        <AppDatePicker
          className="grid-header-filter__input"
          value={dateColumnFilter}
          ariaLabel={`Filtrar ${panelTitle.toLowerCase()} por fecha`}
          placeholder="AAAA-MM-DD"
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.stopPropagation();
            }
          }}
          onChange={setDateColumnFilter}
        />
      </div>
    );
  }

  function renderBrokerHeaderCell(_props: RenderHeaderCellProps<TradeGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Broker</div>
        <AppSelect
          compact
          ariaLabel={`Filtrar ${panelTitle.toLowerCase()} por broker`}
          options={brokerFilterOptions}
          value={brokerFilterId}
          placeholder="Todos"
          onChange={setBrokerFilterId}
        />
      </div>
    );
  }

  const columns = useMemo<readonly Column<TradeGridRow>[]>(() => {
    const actionColumn: Column<TradeGridRow> = {
      key: 'actions',
      name: '',
      width: ACTION_COLUMN_WIDTH,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
        const buyRowLocked = isBuyRowLocked(row);
        const showPrimaryActions = row.isDraft || row.status === 'dirty' || row.status === 'error';
        const actionCount = showPrimaryActions ? 2 : 1;

        return (
          <div className={`grid-actions grid-actions--${actionCount}`}>
            {showPrimaryActions ? (
              <>
                <button
                  type="button"
                  className="grid-action grid-action--save"
                  title="Guardar"
                  aria-label="Guardar"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    commitActiveEditorAndRun(() => {
                      void persistRow(row.id);
                    });
                  }}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                <button
                  type="button"
                  className={`grid-action ${row.isDraft ? 'grid-action--clear' : 'grid-action--revert'}`}
                  title={row.isDraft ? 'Limpiar' : 'Deshacer'}
                  aria-label={row.isDraft ? 'Limpiar' : 'Deshacer'}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRevertRow(row);
                  }}
                >
                  <FontAwesomeIcon icon={row.isDraft ? faEraser : faRotateLeft} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="grid-action grid-action--delete"
                title={buyRowLocked ? 'Bloqueada por ventas FIFO' : 'Eliminar'}
                aria-label={buyRowLocked ? 'Compra bloqueada por ventas FIFO' : 'Eliminar'}
                disabled={buyRowLocked}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleDeleteRow(row);
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            )}
          </div>
        );
      },
    };

    const tickerColumn: Column<TradeGridRow> = {
      key: 'securityId',
      name: 'Ticker',
      width: 172,
      headerCellClass: 'grid-header-filter-cell',
      renderHeaderCell: renderTickerHeaderCell,
      renderCell: ({ row }) => securityLabelById.get(row.securityId) ?? '-',
      renderEditCell: (props) => <SelectCellEditor {...props} options={securityOptions} />,
    };

    const baseColumns: Column<TradeGridRow>[] = [
      actionColumn,
      tickerColumn,
      {
        key: 'brokerId',
        name: 'Broker',
        width: 148,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderBrokerHeaderCell,
        renderCell: ({ row }) => brokerLabelById.get(row.brokerId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={brokerOptions} />,
      },
    ];

    if (kind === 'sell') {
      return [
        actionColumn,
        {
          key: 'tradeDate',
          name: 'F. venta',
          width: DEFAULT_COLUMN_WIDTH,
          headerCellClass: 'grid-header-filter-cell',
          renderHeaderCell: renderDateHeaderCell,
          renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
        },
        tickerColumn,
        {
          key: 'brokerId',
          name: 'Broker',
          width: 148,
          headerCellClass: 'grid-header-filter-cell',
          renderHeaderCell: renderBrokerHeaderCell,
          renderCell: ({ row }) => brokerLabelById.get(row.brokerId) ?? '-',
          renderEditCell: (props) => <SelectCellEditor {...props} options={brokerOptions} />,
        },
        {
          key: 'quantityHeldBeforeSell',
          name: 'Disp. antes',
          width: 110,
          editable: false,
          renderCell: ({ row }) => {
            const availableQuantity = row.isDraft ? draftSellPreview?.availableQuantity ?? null : row.quantityHeldBeforeSell.trim() ? Number(row.quantityHeldBeforeSell) : null;

            return availableQuantity != null && Number.isFinite(availableQuantity) ? formatEditableNumber(availableQuantity) : '-';
          },
        },
        {
          key: 'quantity',
          name: 'Títulos',
          width: AMOUNT_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
        },
        {
          key: 'unitPriceOriginal',
          name: 'P. venta',
          width: AMOUNT_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
        },
        {
          key: 'feesOriginal',
          name: 'Comisión',
          width: AMOUNT_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
        },
        {
          key: 'currencyCode',
          name: 'Moneda',
          width: 88,
          renderEditCell: (props) => <SelectCellEditor {...props} options={investmentCurrencyOptions} />,
        },
        {
          key: 'fxRateToMxn',
          name: 'FX',
          width: 86,
          renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
          renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="1" />,
        },
        {
          key: 'totalAmountMxn',
          name: 'Neto MXN',
          width: 118,
          editable: false,
          renderCell: ({ row }) => {
            const total = row.totalAmountMxn.trim() ? Number(row.totalAmountMxn) : null;

            return total != null && Number.isFinite(total) ? formatCurrencyTotal(total) : '-';
          },
        },
        {
          key: 'priceMxn',
          name: 'Precio MXN',
          width: 120,
          editable: false,
          renderCell: ({ row }) => {
            const unitPrice = row.unitPriceOriginal.trim() ? Number(row.unitPriceOriginal) : null;
            const fxRate = row.currencyCode === 'MXN' ? 1 : row.fxRateToMxn.trim() ? Number(row.fxRateToMxn) : null;
            const priceMxn = unitPrice != null && fxRate != null && Number.isFinite(unitPrice) && Number.isFinite(fxRate) ? unitPrice * fxRate : null;

            return priceMxn != null ? formatCurrencyTotal(priceMxn) : '-';
          },
        },
        {
          key: 'buyTradeDate',
          name: 'F. compra',
          width: DEFAULT_COLUMN_WIDTH,
          editable: false,
          renderCell: ({ row }) => (row.stockBuyId ? buyById.get(row.stockBuyId)?.tradeDate ?? '-' : '-'),
        },
        {
          key: 'buyUnitPriceOriginal',
          name: 'P. compra',
          width: AMOUNT_COLUMN_WIDTH,
          editable: false,
          renderCell: ({ row }) => (row.stockBuyId ? formatEditableNumber(buyById.get(row.stockBuyId)?.unitPriceOriginal) || '-' : '-'),
        },
        {
          key: 'fifoRealizedPnlMxn',
          name: 'PnL',
          width: 118,
          sortable: true,
          editable: false,
          renderCell: ({ row }) => {
            const pnl = getSellRowRealizedPnl(row, draftSellPreview);
            return pnl != null && Number.isFinite(pnl) ? <span className={getPnlToneClass(pnl)}>{formatCurrencyTotal(pnl)}</span> : '-';
          },
        },
        {
          key: 'fifoRealizedPnlPct',
          name: 'PnL %',
          width: 96,
          sortable: true,
          editable: false,
          renderCell: ({ row }) => {
            const pnl = getSellRowRealizedPnl(row, draftSellPreview);
            const pct = getSellRowRealizedPnlPct(row, draftSellPreview);

            return pnl != null && Number.isFinite(pnl) ? <span className={getPnlToneClass(pnl)}>{formatPercentage(pct)}</span> : '-';
          },
        },
        {
          key: 'holdingPeriodYears',
          name: 'Años',
          width: 84,
          sortable: true,
          editable: false,
          renderCell: ({ row }) => formatHoldingPeriodYears(getSellRowHoldingPeriodYears(row, draftSellPreview, buyById)),
        },
        {
          key: 'fifoRealizedCagr',
          name: 'CAGR',
          width: 96,
          sortable: true,
          editable: false,
          renderCell: ({ row }) => {
            const cagr = getSellRowRealizedCagr(row, draftSellPreview, buyById);

            return cagr != null && Number.isFinite(cagr) ? <span className={getPnlToneClass(cagr)}>{formatPercentage(cagr)}</span> : '-';
          },
        },
        {
          key: 'notes',
          name: 'Notas',
          width: NOTES_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
        },
      ] satisfies readonly Column<TradeGridRow>[];
    }

    return [
      ...baseColumns,
      {
        key: 'tradeDate',
        name: 'Fecha',
        width: DEFAULT_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderDateHeaderCell,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: AMOUNT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
      },
      {
        key: 'soldQuantity',
        name: 'Vendidos',
        width: 96,
        editable: false,
        renderCell: ({ row }) => {
          const soldQuantity = row.isDraft ? null : buyConsumptionById.get(row.persistedId ?? row.id)?.soldQuantity ?? 0;

          return soldQuantity != null && soldQuantity > POSITION_EPSILON ? formatEditableNumber(soldQuantity) : '0';
        },
      },
      {
        key: 'unitPriceOriginal',
        name: 'Precio',
        width: AMOUNT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
      },
      {
        key: 'feesOriginal',
        name: 'Comisión',
        width: AMOUNT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: 88,
        renderEditCell: (props) => <SelectCellEditor {...props} options={investmentCurrencyOptions} />,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX',
        width: 86,
        renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="1" />,
      },
      {
        key: 'totalAmountMxn',
        name: 'MXN',
        width: AMOUNT_COLUMN_WIDTH,
        editable: false,
      },
      {
        key: 'notes',
        name: 'Notas',
        width: NOTES_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
      },
    ] satisfies readonly Column<TradeGridRow>[];
  }, [brokerFilterId, brokerFilterOptions, brokerLabelById, brokerOptions, buyById, buyConsumptionById, dateColumnFilter, draftSellPreview, handleDeleteRow, handleRevertRow, isBuyRowLocked, kind, panelTitle, persistRow, securityLabelById, securityOptions, tickerFilter]);

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;
  const draftSellFeedback = draftSellPreview?.errorMessage ?? null;

  const handleNavigateToNextCell = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef,
        columns,
        rows: sortedRows,
        rowIdx,
        columnIdx,
        isCellEditable: ({ row, column }) => Boolean(column.renderEditCell) && (kind !== 'sell' || row.isDraft) && !isBuyRowLocked(row),
      });
    },
    [columns, isBuyRowLocked, kind, sortedRows],
  );

  function focusCellEditor(rowIdx: number, columnIdx: number, columnKey: string) {
    const cellId = `${rowIdx}:${columnKey}`;

    if (autoEditCellRef.current === cellId) {
      return;
    }

    autoEditCellRef.current = cellId;

    window.setTimeout(() => {
      gridRef.current?.selectCell({ rowIdx, idx: columnIdx }, { enableEditor: true, shouldFocusCell: true });

      window.setTimeout(() => {
        if (autoEditCellRef.current === cellId) {
          autoEditCellRef.current = null;
        }
      }, 0);
    }, 0);
  }

  return (
    <div className="page">
      <section className="card finance-panel">
        <div className="income-toolbar">
          <div className="income-toolbar__controls">
            <PeriodFilter
              ariaLabel={`Filtrar ${panelTitle.toLowerCase()} por fecha`}
              value={dateFilter}
              onChange={setDateFilter}
              disabled={isLoading}
            />
          </div>

          <div className="badge-row" aria-label={`Resumen de ${panelTitle.toLowerCase()} visibles`}>
            <span className="badge">{visibleSummary.count} regs</span>
            <span className="badge">{visibleSummary.totalLabel}</span>
            {kind === 'buy' ? <span className="badge">{visibleSummary.totalQuantityLabel} títulos</span> : null}
            {kind === 'buy' && visibleSummary.activeQuantityLabel ? <span className="badge">Act. {visibleSummary.activeQuantityLabel} títulos</span> : null}
            {kind === 'buy' && visibleSummary.activeTotalLabel ? <span className="badge">Costo act. {visibleSummary.activeTotalLabel}</span> : null}
            {kind === 'buy' && visibleSummary.activeOpenCount != null ? <span className="badge">Abiertas {visibleSummary.activeOpenCount}</span> : null}
            {kind === 'buy' && visibleSummary.closedCount != null ? <span className="badge">Cerradas {visibleSummary.closedCount}</span> : null}
            {kind === 'buy' && visibleSummary.activeUnitCostLabel ? <span className="badge">CP act. {visibleSummary.activeUnitCostLabel}</span> : null}
            {kind === 'sell' && visibleSummary.totalRealizedPnl != null ? (
              <span
                className={`badge ${getPnlToneClass(visibleSummary.totalRealizedPnl)} badge--pnl`}
                title="Plusvalía o minusvalía total visible"
              >
                {formatCurrencyTotal(visibleSummary.totalRealizedPnl)}
              </span>
            ) : null}
          </div>
        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        {currentErrorMessage ? <div className="feedback-banner feedback-banner--error">{currentErrorMessage}</div> : null}
        {draftSellFeedback ? <div className="feedback-banner feedback-banner--error">{draftSellFeedback}</div> : null}

        <div className="grid-wrapper grid-wrapper--tall">
          <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateToNextCell}>
            <DataGrid
              ref={gridRef}
              columns={columns}
              rows={sortedRows}
              rowHeight={GRID_ROW_HEIGHT}
              headerRowHeight={FILTER_HEADER_ROW_HEIGHT}
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleRowsChange}
              sortColumns={sortColumns}
              onSortColumnsChange={(nextSortColumns) => {
                setSortColumns(nextSortColumns.filter((sort) => SELL_SORTABLE_COLUMN_KEYS.has(sort.columnKey)));
              }}
              onCellClick={(args) => {
                setSelectedRowId(args.row.id);

                if ((kind === 'sell' && !args.row.isDraft) || isBuyRowLocked(args.row)) {
                  return;
                }

                if (args.column.renderEditCell) {
                  args.selectCell(true);
                }
              }}
              onSelectedCellChange={(args) => {
                setSelectedRowId(args.row?.id ?? null);

                if (((kind === 'sell' && args.row && !args.row.isDraft) || (args.row && isBuyRowLocked(args.row)))) {
                  return;
                }

                if (args.row && args.column.renderEditCell) {
                  focusCellEditor(args.rowIdx, args.column.idx, args.column.key);
                }
              }}
              defaultColumnOptions={{ resizable: true }}
              rowClass={(row) => {
                const classNames: string[] = [];
                if (row.status === 'saving') classNames.push('row-saving');
                else if (row.status === 'error') classNames.push('row-error');
                else if (row.status === 'new') classNames.push('row-new');
                else if (row.status === 'dirty') classNames.push('row-dirty');
                else classNames.push('row-saved');

                if (isBuyRowClosed(row)) {
                  classNames.push('row-buy-closed');
                }

                if (row.id === selectedRowId) {
                  classNames.push('row-selected-soft');
                }

                if (kind === 'sell' && !row.isDraft && row.sellGroupId) {
                  const rowIndex = sortedRows.findIndex((candidate) => candidate.id === row.id);
                  const previousRow = rowIndex > 0 ? sortedRows[rowIndex - 1] : null;
                  const nextRow = rowIndex >= 0 && rowIndex < sortedRows.length - 1 ? sortedRows[rowIndex + 1] : null;
                  const isGroupStart = previousRow?.sellGroupId !== row.sellGroupId;
                  const isGroupEnd = nextRow?.sellGroupId !== row.sellGroupId;

                  classNames.push('row-sell-group');
                  if (isGroupStart) classNames.push('row-sell-group-start');
                  if (isGroupEnd) classNames.push('row-sell-group-end');
                }

                return classNames.join(' ');
              }}
              style={{ blockSize: 500 }}
            />
          </GridEditorNavigationProvider>
        </div>
      </section>
    </div>
  );
}
