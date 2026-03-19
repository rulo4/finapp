import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle } from 'react-data-grid';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../shared/gridEditors';
import { isIsoDateString } from '../shared/isoDate';
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client';
import {
  type Broker,
  type InvestmentDateFilterMode,
  commitActiveEditorAndRun,
  createLocalId,
  formatCurrencyTotal,
  formatEditableNumber,
  getDateRange,
  getTodayDate,
  investmentCurrencyOptions,
  isDateWithinRange,
  isErrorFeedback,
} from './shared';

type TradeKind = 'buy' | 'sell';

type TradeDbRow = {
  id: string;
  trade_date: string;
  broker_id: string;
  ticker: string;
  currency_code: 'MXN' | 'USD';
  quantity: number;
  unit_price_original: number;
  fees_original: number | null;
  fx_rate_to_mxn: number | null;
  total_amount_mxn: number;
  notes: string | null;
};

type TradeGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  tradeDate: string;
  brokerId: string;
  ticker: string;
  currencyCode: 'MXN' | 'USD';
  quantity: string;
  unitPriceOriginal: string;
  feesOriginal: string;
  fxRateToMxn: string;
  totalAmountMxn: string;
  notes: string;
};

const GRID_ROW_HEIGHT = 30;
const DEFAULT_COLUMN_WIDTH = 108;
const AMOUNT_COLUMN_WIDTH = 92;
const ACTION_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 160;

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

function createDraftTradeRow(): TradeGridRow {
  return {
    id: createLocalId('trade-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    tradeDate: getTodayDate(),
    brokerId: '',
    ticker: '',
    currencyCode: 'MXN',
    quantity: '',
    unitPriceOriginal: '',
    feesOriginal: '0',
    fxRateToMxn: '1',
    totalAmountMxn: '',
    notes: '',
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
    ticker: normalizeTicker(row.ticker),
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
      normalizeTicker(row.ticker) &&
      row.quantity.trim() &&
      row.unitPriceOriginal.trim() &&
      (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()),
  );
}

function formatTradeIssuesMessage(row: TradeGridRow) {
  const issues: string[] = [];

  if (!row.tradeDate.trim()) issues.push('captura la fecha');
  if (!normalizeTicker(row.ticker)) issues.push('captura el ticker');
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

  if (!normalizeTicker(row.ticker)) {
    return 'captura un ticker';
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
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    tradeDate: row.trade_date,
    brokerId: row.broker_id,
    ticker: row.ticker,
    currencyCode: row.currency_code,
    quantity: formatEditableNumber(row.quantity),
    unitPriceOriginal: formatEditableNumber(row.unit_price_original),
    feesOriginal: formatEditableNumber(row.fees_original ?? 0),
    fxRateToMxn: formatEditableNumber(row.currency_code === 'MXN' ? 1 : (row.fx_rate_to_mxn ?? 1)),
    totalAmountMxn: formatEditableNumber(row.total_amount_mxn),
    notes: row.notes ?? '',
  };
}

export function StockTradesPage({ kind }: { kind: TradeKind }) {
  const tableName = kind === 'buy' ? 'stock_buys' : 'stock_sells';
  const panelTitle = kind === 'buy' ? 'Compras de acciones' : 'Ventas de acciones';
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [rows, setRows] = useState<TradeGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<InvestmentDateFilterMode>('year');
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

    let entriesQuery = supabase
      .from(tableName)
      .select('id, trade_date, broker_id, ticker, currency_code, quantity, unit_price_original, fees_original, fx_rate_to_mxn, total_amount_mxn, notes')
      .order('trade_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('trade_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('trade_date', activeDateRange.end);
    }

    const [{ data: brokerData, error: brokerError }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('brokers').select('id, name').eq('is_active', true).order('name', { ascending: true }),
      entriesQuery,
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

    const nextBrokers = (brokerData as Broker[]) ?? [];
    const nextRows = ((entryData as TradeDbRow[]) ?? []).map(toTradeGridRow);
    const loadedRows = withDraftRow(nextRows);

    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    rowsRef.current = loadedRows;
    setBrokers(nextBrokers);
    setRows(loadedRows);
    setFeedback(nextBrokers.length > 0 ? null : 'Primero crea al menos un broker en Catálogos.');
    setIsLoading(false);
  }, [activeDateRange.end, activeDateRange.start, panelTitle, tableName]);

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
      ticker: normalizeTicker(row.ticker),
      currency_code: row.currencyCode,
      quantity: Number(quantity.toFixed(6)),
      unit_price_original: Number(unitPrice.toFixed(6)),
      fees_original: Number(fees.toFixed(6)),
      fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : Number(fxRateToMxn.toFixed(6)),
      total_amount_mxn: Number((totalOriginal * fxRateToMxn).toFixed(6)),
      notes: row.notes.trim() || null,
    };

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

    setFeedback(kind === 'buy' ? 'Compra guardada.' : 'Venta guardada.');
  }, [activeDateRange, kind, tableName]);

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

    if (!window.confirm(kind === 'buy' ? 'Eliminar esta compra?' : 'Eliminar esta venta?')) {
      return;
    }

    const { error } = await supabase.from(tableName).delete().eq('id', row.persistedId);
    if (error) {
      setFeedback(`No fue posible eliminar el movimiento: ${error.message}`);
      return;
    }

    persistedRowsRef.current.delete(row.id);
    setRows((currentRows) => {
      const nextRows = withDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback(kind === 'buy' ? 'Compra eliminada.' : 'Venta eliminada.');
  }, [kind, tableName]);

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
  const visibleSummary = useMemo(() => {
    const visibleRows = rows.filter((row) => !row.isDraft);
    const totalAmount = visibleRows.reduce((sum, row) => {
      const rowTotal = Number(row.totalAmountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);

    return {
      count: visibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
    };
  }, [rows]);

  const columns = useMemo<readonly Column<TradeGridRow>[]>(() => [
    {
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
    },
    {
      key: 'tradeDate',
      name: 'Fecha',
      width: DEFAULT_COLUMN_WIDTH,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
    },
    {
      key: 'ticker',
      name: 'Ticker',
      width: 108,
      renderEditCell: (props) => <InputCellEditor {...props} placeholder="AAPL" />,
    },
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
  ], [brokerLabelById, brokerOptions, handleDeleteRow, handleRevertRow, persistRow]);

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;

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
          </div>
        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        {currentErrorMessage ? <div className="feedback-banner feedback-banner--error">{currentErrorMessage}</div> : null}

        <div className="grid-wrapper grid-wrapper--tall">
          <DataGrid
            ref={gridRef}
            columns={columns}
            rows={rows}
            rowHeight={GRID_ROW_HEIGHT}
            headerRowHeight={GRID_ROW_HEIGHT}
            rowKeyGetter={(row) => row.id}
            onRowsChange={handleRowsChange}
            onCellClick={(args) => {
              if (args.column.renderEditCell) {
                args.selectCell(true);
              }
            }}
            onSelectedCellChange={(args) => {
              if (args.row && args.column.renderEditCell) {
                focusCellEditor(args.rowIdx, args.column.idx, args.column.key);
              }
            }}
            defaultColumnOptions={{ resizable: true }}
            rowClass={(row) => {
              if (row.status === 'saving') return 'row-saving';
              if (row.status === 'error') return 'row-error';
              if (row.status === 'new') return 'row-new';
              if (row.status === 'dirty') return 'row-dirty';
              return 'row-saved';
            }}
            style={{ blockSize: 500 }}
          />
        </div>
      </section>
    </div>
  );
}
