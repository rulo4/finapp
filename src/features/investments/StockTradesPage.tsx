import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type RenderHeaderCellProps } from 'react-data-grid';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../shared/gridEditors';
import { isIsoDateString } from '../shared/isoDate';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import {
  type Broker,
  type InvestmentDateFilterMode,
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
import { previewFifoSell, type StockBuyMovement, type StockSellMovement } from './positionMetrics';

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
  security_id: string;
  trade_date: string;
  quantity: number;
  unit_price_original: number;
  total_amount_mxn: number;
  created_at: string;
};

type SellHistoryRow = {
  id: string;
  security_id: string;
  trade_date: string;
  quantity: number;
  total_amount_mxn: number;
  created_at: string;
  stock_buy_id: string | null;
  sell_group_id: string | null;
};

const GRID_ROW_HEIGHT = 30;
const FILTER_HEADER_ROW_HEIGHT = 64;
const DEFAULT_COLUMN_WIDTH = 108;
const AMOUNT_COLUMN_WIDTH = 92;
const ACTION_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 160;

function createDraftTradeRow(): TradeGridRow {
  return {
    id: createLocalId('trade-draft'),
    persistedId: null,
    createdAt: null,
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

function withDraftRow(rows: TradeGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftTradeRow();

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function normalizeTradeGridRow(row: TradeGridRow, kind: TradeKind): TradeGridRow {
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
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
    return 'usa una fecha valida en formato AAAA-MM-DD';
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
    return 'usa una comisión valida';
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
  const [tickerFilter, setTickerFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<InvestmentDateFilterMode>('year');
  const [buyHistory, setBuyHistory] = useState<StockBuyMovement[]>([]);
  const [sellHistory, setSellHistory] = useState<StockSellMovement[]>([]);
  const rowsRef = useRef<TradeGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, TradeGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const activeDateRange = useMemo(() => getDateRange(dateFilterMode), [dateFilterMode]);

  const loadData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no esta configurado para este entorno.');
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
      supabase.from('brokers').select('id, name').eq('is_active', true).order('name', { ascending: true }),
      supabase.from('securities').select('id, ticker, company_name, exchange_code, is_active').order('ticker', { ascending: true }),
      entriesQuery,
      kind === 'sell'
        ? supabase.from('stock_buys').select('id, security_id, trade_date, quantity, unit_price_original, total_amount_mxn, created_at')
        : Promise.resolve({ data: [], error: null }),
      kind === 'sell'
        ? supabase.from('stock_sells').select('id, security_id, trade_date, quantity, total_amount_mxn, created_at, stock_buy_id, sell_group_id')
        : Promise.resolve({ data: [], error: null }),
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
        securityId: row.security_id,
        tradeDate: row.trade_date,
        quantity: Number(row.quantity),
        totalAmountMxn: Number(row.total_amount_mxn),
        createdAt: row.created_at,
        stockBuyId: row.stock_buy_id,
        sellGroupId: row.sell_group_id,
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

  function handleRowsChange(nextRows: TradeGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0] ?? null;

    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    if (kind === 'sell' && !nextRows[rowIndex].isDraft) {
      const restoredRow = persistedRowsRef.current.get(nextRows[rowIndex].id) ?? nextRows[rowIndex];
      const restoredRows = nextRows.map((row, index) => (index === rowIndex ? restoredRow : row));
      rowsRef.current = restoredRows;
      setRows(restoredRows);
      setFeedback('Las ventas guardadas se ajustan eliminando y capturando de nuevo el movimiento.');
      return;
    }

    const normalizedRow = normalizeTradeGridRow(nextRows[rowIndex], kind);
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
  }

  const persistRow = useCallback(async (rowId: string) => {
    if (!supabase) {
      setFeedback('Supabase no esta disponible para guardar movimientos.');
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
  }, [activeDateRange, buyHistory, kind, loadData, sellHistory, tableName]);

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
      setFeedback('Supabase no esta disponible para eliminar movimientos.');
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
  }, [kind, loadData, tableName]);

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
    const normalizedFilter = tickerFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return rows;
    }

    return rows.filter((row) => {
      if (row.isDraft) {
        return true;
      }

      const tickerLabel = securityLabelById.get(row.securityId)?.toLowerCase() ?? '';
      return tickerLabel.includes(normalizedFilter);
    });
  }, [rows, securityLabelById, tickerFilter]);
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

    return {
      count: visibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
      totalQuantityLabel: formatQuantityTotal(totalQuantity),
      totalRealizedPnl,
    };
  }, [filteredRows, kind]);
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

  const columns = useMemo<readonly Column<TradeGridRow>[]>(() => {
    const actionColumn: Column<TradeGridRow> = {
      key: 'actions',
      name: '',
      width: ACTION_COLUMN_WIDTH,
      frozen: true,
      editable: false,
      renderCell: ({ row }) => {
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
                title="Eliminar"
                aria-label="Eliminar"
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
        renderCell: ({ row }) => brokerLabelById.get(row.brokerId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={brokerOptions} />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: 88,
        renderEditCell: (props) => <SelectCellEditor {...props} options={investmentCurrencyOptions} />,
      },
    ];

    if (kind === 'sell') {
      return [
        actionColumn,
        {
          key: 'tradeDate',
          name: 'F. venta',
          width: DEFAULT_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
        },
        tickerColumn,
        {
          key: 'brokerId',
          name: 'Broker',
          width: 148,
          renderCell: ({ row }) => brokerLabelById.get(row.brokerId) ?? '-',
          renderEditCell: (props) => <SelectCellEditor {...props} options={brokerOptions} />,
        },
        {
          key: 'currencyCode',
          name: 'Moneda',
          width: 88,
          renderEditCell: (props) => <SelectCellEditor {...props} options={investmentCurrencyOptions} />,
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
          key: 'notes',
          name: 'Notas',
          width: NOTES_COLUMN_WIDTH,
          renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
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
          editable: false,
          renderCell: ({ row }) => {
            const pnl = row.fifoRealizedPnlMxn.trim() ? Number(row.fifoRealizedPnlMxn) : null;
            return pnl != null && Number.isFinite(pnl) ? <span className={getPnlToneClass(pnl)}>{formatCurrencyTotal(pnl)}</span> : '-';
          },
        },
        {
          key: 'fifoRealizedPnlPct',
          name: 'PnL %',
          width: 96,
          editable: false,
          renderCell: ({ row }) => {
            const pnl = row.fifoRealizedPnlMxn.trim() ? Number(row.fifoRealizedPnlMxn) : null;
            const basis = row.fifoCostBasisMxn.trim() ? Number(row.fifoCostBasisMxn) : null;
            const pct = pnl != null && basis != null && Number.isFinite(pnl) && Number.isFinite(basis) && basis !== 0 ? pnl / basis : null;

            return pnl != null && Number.isFinite(pnl) ? <span className={getPnlToneClass(pnl)}>{formatPercentage(pct)}</span> : '-';
          },
        },
      ] satisfies readonly Column<TradeGridRow>[];
    }

    return [
      ...baseColumns,
      {
        key: 'tradeDate',
        name: 'Fecha',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: AMOUNT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
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
  }, [brokerLabelById, brokerOptions, buyById, draftSellPreview, handleDeleteRow, handleRevertRow, kind, panelTitle, persistRow, securityLabelById, securityOptions, tickerFilter]);

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;
  const draftSellFeedback = draftSellPreview?.errorMessage ?? null;

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
            <div className="income-period-filter" role="group" aria-label={`Filtrar ${panelTitle.toLowerCase()} por fecha`}>
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

          <div className="badge-row" aria-label={`Resumen de ${panelTitle.toLowerCase()} visibles`}>
            <span className="badge">{visibleSummary.count} regs</span>
            <span className="badge">{visibleSummary.totalLabel}</span>
            {kind === 'buy' ? <span className="badge">{visibleSummary.totalQuantityLabel} títulos</span> : null}
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
          <DataGrid
            ref={gridRef}
            columns={columns}
            rows={filteredRows}
            rowHeight={GRID_ROW_HEIGHT}
            headerRowHeight={FILTER_HEADER_ROW_HEIGHT}
            rowKeyGetter={(row) => row.id}
            onRowsChange={handleRowsChange}
            onCellClick={(args) => {
              if (kind === 'sell' && !args.row.isDraft) {
                return;
              }

              if (args.column.renderEditCell) {
                args.selectCell(true);
              }
            }}
            onSelectedCellChange={(args) => {
              if (kind === 'sell' && args.row && !args.row.isDraft) {
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

              if (kind === 'sell' && !row.isDraft && row.sellGroupId) {
                const rowIndex = filteredRows.findIndex((candidate) => candidate.id === row.id);
                const previousRow = rowIndex > 0 ? filteredRows[rowIndex - 1] : null;
                const nextRow = rowIndex >= 0 && rowIndex < filteredRows.length - 1 ? filteredRows[rowIndex + 1] : null;
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
        </div>
      </section>
    </div>
  );
}
