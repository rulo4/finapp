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

type DividendDbRow = {
  id: string;
  entry_date: string;
  broker_id: string;
  ticker: string;
  currency_code: 'MXN' | 'USD';
  gross_amount_original: number;
  tax_withheld_original: number | null;
  fx_rate_to_mxn: number | null;
  net_amount_mxn: number;
  notes: string | null;
};

type DividendGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  entryDate: string;
  brokerId: string;
  ticker: string;
  currencyCode: 'MXN' | 'USD';
  grossAmountOriginal: string;
  taxWithheldOriginal: string;
  fxRateToMxn: string;
  netAmountMxn: string;
  notes: string;
};

const GRID_ROW_HEIGHT = 30;
const DEFAULT_COLUMN_WIDTH = 108;
const AMOUNT_COLUMN_WIDTH = 96;
const ACTION_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 160;

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

function createDraftDividendRow(): DividendGridRow {
  return {
    id: createLocalId('dividend-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    entryDate: getTodayDate(),
    brokerId: '',
    ticker: '',
    currencyCode: 'MXN',
    grossAmountOriginal: '',
    taxWithheldOriginal: '0',
    fxRateToMxn: '1',
    netAmountMxn: '',
    notes: '',
  };
}

function withDraftRow(rows: DividendGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftDividendRow();

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function normalizeDividendGridRow(row: DividendGridRow): DividendGridRow {
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
  const gross = Number(row.grossAmountOriginal);
  const tax = Number(row.taxWithheldOriginal || '0');
  const fxRate = Number(fxRateToMxn);
  const netOriginal = gross - tax;

  return {
    ...row,
    ticker: normalizeTicker(row.ticker),
    fxRateToMxn,
    taxWithheldOriginal: row.taxWithheldOriginal.trim() ? row.taxWithheldOriginal : '0',
    netAmountMxn:
      Number.isFinite(netOriginal) && netOriginal >= 0 && Number.isFinite(fxRate) && fxRate > 0
        ? formatEditableNumber(Number((netOriginal * fxRate).toFixed(6)))
        : '',
  };
}

function canSaveDraftDividendRow(row: DividendGridRow) {
  return Boolean(
    row.entryDate.trim() &&
      row.brokerId &&
      normalizeTicker(row.ticker) &&
      row.grossAmountOriginal.trim() &&
      (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()),
  );
}

function formatDividendIssuesMessage(row: DividendGridRow) {
  const issues: string[] = [];

  if (!row.entryDate.trim()) issues.push('captura la fecha');
  if (!normalizeTicker(row.ticker)) issues.push('captura el ticker');
  if (!row.brokerId) issues.push('selecciona el broker');
  if (!row.grossAmountOriginal.trim()) issues.push('captura el bruto');
  if (row.currencyCode !== 'MXN' && !row.fxRateToMxn.trim()) issues.push('captura el tipo de cambio');

  return issues.length > 0 ? `No se puede guardar la fila: ${issues.join(', ')}.` : 'Revisa la fila.';
}

function validateDividendRow(row: DividendGridRow) {
  if (!row.entryDate || !isIsoDateString(row.entryDate)) {
    return 'usa una fecha valida en formato AAAA-MM-DD';
  }

  if (!normalizeTicker(row.ticker)) {
    return 'captura un ticker';
  }

  if (!row.brokerId) {
    return 'selecciona un broker';
  }

  const gross = Number(row.grossAmountOriginal);
  if (!row.grossAmountOriginal.trim() || !Number.isFinite(gross) || gross < 0) {
    return 'usa un bruto valido';
  }

  const tax = Number(row.taxWithheldOriginal || '0');
  if (!Number.isFinite(tax) || tax < 0) {
    return 'usa una retención valida';
  }

  if (tax > gross) {
    return 'la retención no puede ser mayor al bruto';
  }

  const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return 'usa un tipo de cambio mayor a cero';
  }

  return null;
}

function toDividendGridRow(row: DividendDbRow): DividendGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    entryDate: row.entry_date,
    brokerId: row.broker_id,
    ticker: row.ticker,
    currencyCode: row.currency_code,
    grossAmountOriginal: formatEditableNumber(row.gross_amount_original),
    taxWithheldOriginal: formatEditableNumber(row.tax_withheld_original ?? 0),
    fxRateToMxn: formatEditableNumber(row.currency_code === 'MXN' ? 1 : (row.fx_rate_to_mxn ?? 1)),
    netAmountMxn: formatEditableNumber(row.net_amount_mxn),
    notes: row.notes ?? '',
  };
}

export function DividendsGridPage() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [rows, setRows] = useState<DividendGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<InvestmentDateFilterMode>('year');
  const rowsRef = useRef<DividendGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, DividendGridRow>>(new Map());
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
      .from('dividend_entries')
      .select('id, entry_date, broker_id, ticker, currency_code, gross_amount_original, tax_withheld_original, fx_rate_to_mxn, net_amount_mxn, notes')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('entry_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('entry_date', activeDateRange.end);
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
      setFeedback(`No fue posible cargar dividendos: ${entryError.message}`);
      setIsLoading(false);
      return;
    }

    const nextBrokers = (brokerData as Broker[]) ?? [];
    const nextRows = ((entryData as DividendDbRow[]) ?? []).map(toDividendGridRow);
    const loadedRows = withDraftRow(nextRows);

    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    rowsRef.current = loadedRows;
    setBrokers(nextBrokers);
    setRows(loadedRows);
    setFeedback(nextBrokers.length > 0 ? null : 'Primero crea al menos un broker en Catálogos.');
    setIsLoading(false);
  }, [activeDateRange.end, activeDateRange.start]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function handleRowsChange(nextRows: DividendGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0] ?? null;

    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const normalizedRow = normalizeDividendGridRow(nextRows[rowIndex]);
    const shouldPersist = normalizedRow.isDraft ? canSaveDraftDividendRow(normalizedRow) : true;
    const validationMessage = shouldPersist ? validateDividendRow(normalizedRow) : null;
    const updatedRows: DividendGridRow[] = nextRows.map((row, index) => {
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
      setFeedback('Supabase no esta disponible para guardar dividendos.');
      return;
    }

    const row = rowsRef.current.find((candidate) => candidate.id === rowId);
    if (!row) {
      setFeedback('No se encontró la fila que intentas guardar. Intenta de nuevo.');
      return;
    }

    if (row.isDraft && !canSaveDraftDividendRow(row)) {
      const draftErrorMessage = formatDividendIssuesMessage(row);
      setRows((currentRows) => {
        const nextRows: DividendGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(draftErrorMessage);
      return;
    }

    const validationMessage = validateDividendRow(row);
    if (validationMessage) {
      setRows((currentRows) => {
        const nextRows: DividendGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(validationMessage);
      return;
    }

    setRows((currentRows) => {
      const nextRows: DividendGridRow[] = currentRows.map((candidate) =>
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
      );
      rowsRef.current = nextRows;
      return nextRows;
    });

    const gross = Number(row.grossAmountOriginal);
    const tax = Number(row.taxWithheldOriginal || '0');
    const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
    const netOriginal = gross - tax;
    const payload = {
      entry_date: row.entryDate,
      broker_id: row.brokerId,
      ticker: normalizeTicker(row.ticker),
      currency_code: row.currencyCode,
      gross_amount_original: Number(gross.toFixed(6)),
      tax_withheld_original: Number(tax.toFixed(6)),
      fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : Number(fxRateToMxn.toFixed(6)),
      net_amount_mxn: Number((netOriginal * fxRateToMxn).toFixed(6)),
      notes: row.notes.trim() || null,
    };

    const result = row.isDraft
      ? await supabase.from('dividend_entries').insert(payload).select('id').single()
      : await supabase.from('dividend_entries').update(payload).eq('id', row.persistedId);

    if (result.error) {
      setRows((currentRows) => {
        const nextRows: DividendGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(`No fue posible guardar el dividendo: ${result.error.message}`);
      return;
    }

    const persistedId = row.isDraft ? result.data?.id ?? null : row.persistedId;
    if (!persistedId) {
      setFeedback('No se recibió el identificador del dividendo guardado.');
      return;
    }

    const savedRow: DividendGridRow = {
      ...normalizeDividendGridRow(row),
      persistedId,
      isDraft: false,
      status: 'saved',
      errorMessage: null,
    };

    if (isDateWithinRange(savedRow.entryDate, activeDateRange)) {
      persistedRowsRef.current.set(rowId, savedRow);
    } else {
      persistedRowsRef.current.delete(rowId);
    }

    setRows((currentRows) => {
      const nextRows = !isDateWithinRange(savedRow.entryDate, activeDateRange)
        ? withDraftRow(currentRows.filter((candidate) => candidate.id !== rowId))
        : withDraftRow(currentRows.map((candidate) => (candidate.id === rowId ? savedRow : candidate)));
      rowsRef.current = nextRows;
      return nextRows;
    });

    setFeedback('Dividendo guardado.');
  }, [activeDateRange]);

  const handleDeleteRow = useCallback(async (row: DividendGridRow) => {
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
      setFeedback('Supabase no esta disponible para eliminar dividendos.');
      return;
    }

    if (!window.confirm('Eliminar este dividendo?')) {
      return;
    }

    const { error } = await supabase.from('dividend_entries').delete().eq('id', row.persistedId);
    if (error) {
      setFeedback(`No fue posible eliminar el dividendo: ${error.message}`);
      return;
    }

    persistedRowsRef.current.delete(row.id);
    setRows((currentRows) => {
      const nextRows = withDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback('Dividendo eliminado.');
  }, []);

  const handleRevertRow = useCallback((row: DividendGridRow) => {
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
      const rowTotal = Number(row.netAmountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);

    return {
      count: visibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
    };
  }, [rows]);

  const columns = useMemo<readonly Column<DividendGridRow>[]>(() => [
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
      key: 'entryDate',
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
      key: 'grossAmountOriginal',
      name: 'Bruto',
      width: AMOUNT_COLUMN_WIDTH,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="0" />,
    },
    {
      key: 'taxWithheldOriginal',
      name: 'Ret.',
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
      key: 'netAmountMxn',
      name: 'MXN neto',
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
            <div className="income-period-filter" role="group" aria-label="Filtrar dividendos por fecha">
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

          <div className="badge-row" aria-label="Resumen de dividendos visibles">
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
