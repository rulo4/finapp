import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type RenderHeaderCellProps } from 'react-data-grid';
import {
  AppSelect,
  FX_AUTO_SWITCH_FEEDBACK,
  InputCellEditor,
  SelectCellEditor,
  autoSwitchCurrencyFromFx,
  type SelectOption,
} from '../features/shared/gridEditors';
import { GridEditorNavigationProvider, moveToNextEditableGridCell } from '../features/shared/gridNavigation';
import {
  getStartOfCurrentMonthIsoDate,
  getStartOfCurrentYearIsoDate,
  getTodayIsoDate,
  isIsoDateString,
} from '../features/shared/isoDate';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type IncomeSource = {
  id: string;
  name: string;
};

type IncomeEntry = {
  id: string;
  source_id: string;
  entry_date: string;
  currency_code: 'MXN' | 'USD';
  amount_original: number;
  fx_rate_to_mxn: number | null;
  amount_mxn: number | null;
  notes: string | null;
  income_sources: {
    name: string;
  } | null;
};

type IncomeEntryRow = Omit<IncomeEntry, 'income_sources'> & {
  income_sources: { name: string } | { name: string }[] | null;
};

type IncomeGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  entryDate: string;
  sourceId: string;
  currencyCode: 'MXN' | 'USD';
  amountOriginal: string;
  fxRateToMxn: string;
  amountMxn: string;
  notes: string;
};

type IncomeDateFilterMode = 'all' | 'month' | 'year';

function normalizeIncomeEntry(row: IncomeEntryRow): IncomeEntry {
  const relation = Array.isArray(row.income_sources) ? row.income_sources[0] ?? null : row.income_sources;

  return {
    ...row,
    income_sources: relation,
  };
}

function getTodayDate() {
  return getTodayIsoDate();
}

function getStartOfCurrentMonth() {
  return getStartOfCurrentMonthIsoDate();
}

function getStartOfCurrentYear() {
  return getStartOfCurrentYearIsoDate();
}

function isErrorFeedback(message: string) {
  const normalizedMessage = message.trim();

  return (
    /^(no\b|supabase\b|necesitas\b|primero\b|la fecha\b|la fila\b|el\b|la\b|selecciona\b|captura\b|este\b)/i.test(
      normalizedMessage,
    ) || /no se pudo/i.test(normalizedMessage)
  );
}

function isDateWithinRange(date: string, range: { start: string; end: string }) {
  if (range.start && date < range.start) {
    return false;
  }

  if (range.end && date > range.end) {
    return false;
  }

  return true;
}

function formatEditableNumber(value: number | null | undefined) {
  if (value == null) {
    return '';
  }

  return String(Number(value));
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_COLUMN_WIDTH = 108;
const GRID_ROW_HEIGHT = 30;
const FILTER_HEADER_ROW_HEIGHT = 64;

function createDraftIncomeRow(defaultSourceId = ''): IncomeGridRow {
  return {
    id: createLocalId('income-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    entryDate: getTodayDate(),
    sourceId: defaultSourceId,
    currencyCode: 'MXN',
    amountOriginal: '',
    fxRateToMxn: '1',
    amountMxn: '',
    notes: '',
  };
}

function withIncomeDraftRow(rows: IncomeGridRow[], defaultSourceId = '') {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftIncomeRow(defaultSourceId);

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function formatCurrencyTotal(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(value);
}

function toIncomeGridRow(entry: IncomeEntry): IncomeGridRow {
  return {
    id: entry.id,
    persistedId: entry.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    entryDate: entry.entry_date,
    sourceId: entry.source_id,
    currencyCode: entry.currency_code,
    amountOriginal: formatEditableNumber(entry.amount_original),
    fxRateToMxn: formatEditableNumber(entry.currency_code === 'MXN' ? 1 : (entry.fx_rate_to_mxn ?? 1)),
    amountMxn: formatEditableNumber(entry.amount_mxn ?? 0),
    notes: entry.notes ?? '',
  };
}

function normalizeIncomeGridRow(row: IncomeGridRow): IncomeGridRow {
  const nextRow = autoSwitchCurrencyFromFx(row);
  const fxRateToMxn = nextRow.currencyCode === 'MXN' ? '1' : nextRow.fxRateToMxn;
  const parsedAmount = Number(row.amountOriginal);
  const parsedFxRate = Number(fxRateToMxn);

  return {
    ...nextRow,
    fxRateToMxn,
    amountMxn:
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      Number.isFinite(parsedFxRate) &&
      parsedFxRate > 0
        ? formatEditableNumber(Number((parsedAmount * parsedFxRate).toFixed(6)))
        : '',
  };
}

function canSaveDraftIncomeRow(row: IncomeGridRow) {
  return Boolean(row.sourceId && row.amountOriginal.trim() && (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()));
}

function getIncomeRowIssues(row: IncomeGridRow) {
  const issues: string[] = [];

  if (!row.entryDate) {
    issues.push('captura la fecha');
  } else if (!isIsoDateString(row.entryDate)) {
    issues.push('usa el formato AAAA-MM-DD');
  }

  if (!row.sourceId) {
    issues.push('selecciona la fuente');
  }

  const parsedAmount = Number(row.amountOriginal);

  if (!row.amountOriginal.trim()) {
    issues.push('captura el monto original');
  } else if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    issues.push('usa un monto mayor a cero');
  }

  const parsedFxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

  if (row.currencyCode !== 'MXN' && !row.fxRateToMxn.trim()) {
    issues.push('captura el tipo de cambio');
  } else if (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0) {
    issues.push('usa un tipo de cambio mayor a cero');
  }

  return issues;
}

function formatIncomeIssuesMessage(row: IncomeGridRow) {
  const issues = getIncomeRowIssues(row);

  if (issues.length === 0) {
    return 'Revisa los valores de la fila antes de guardar.';
  }

  return `No se puede guardar el ingreso: ${issues.join(', ')}.`;
}

function validateIncomeRow(row: IncomeGridRow) {
  if (!isIsoDateString(row.entryDate)) {
    return 'La fecha debe usar el formato AAAA-MM-DD.';
  }

  if (!row.sourceId) {
    return 'Selecciona una fuente.';
  }

  const parsedAmount = Number(row.amountOriginal);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return 'El monto original debe ser mayor a cero.';
  }

  const parsedFxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

  if (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0) {
    return 'El tipo de cambio debe ser mayor a cero.';
  }

  return null;
}

export function IncomePage() {
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [rows, setRows] = useState<IncomeGridRow[]>([]);
  const [sourceFilterId, setSourceFilterId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<IncomeDateFilterMode>('month');
  const rowsRef = useRef<IncomeGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, IncomeGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const activeDateRange = useMemo(() => {
    if (dateFilterMode === 'month') {
      return {
        start: getStartOfCurrentMonth(),
        end: getTodayDate(),
      };
    }

    if (dateFilterMode === 'year') {
      return {
        start: getStartOfCurrentYear(),
        end: getTodayDate(),
      };
    }

    return {
      start: '',
      end: '',
    };
  }, [dateFilterMode]);

  const loadIncomeData = useCallback(async () => {
    if (!activeDateRange) {
      return;
    }

    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no está configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    let entriesQuery = supabase
      .from('income_entries')
      .select('id, source_id, entry_date, currency_code, amount_original, fx_rate_to_mxn, amount_mxn, notes, income_sources(name)')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('entry_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('entry_date', activeDateRange.end);
    }

    const [{ data: sourceData, error: sourceError }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('income_sources').select('id, name').order('name', { ascending: true }),
      entriesQuery,
    ]);

    if (sourceError) {
      setFeedback(`No fue posible cargar fuentes de ingreso: ${sourceError.message}`);
      setIsLoading(false);
      return;
    }

    if (entryError) {
      setFeedback(`No fue posible cargar ingresos: ${entryError.message}`);
      setSources((sourceData as IncomeSource[]) ?? []);
      setIsLoading(false);
      return;
    }

    const nextSources = (sourceData as IncomeSource[]) ?? [];
    const nextRows = ((entryData as IncomeEntryRow[]) ?? []).map(normalizeIncomeEntry).map(toIncomeGridRow);
    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));

    const loadedRows = withIncomeDraftRow(nextRows, nextSources[0]?.id ?? '');

    rowsRef.current = loadedRows;
    setSources(nextSources);
    setRows(loadedRows);
    setFeedback(nextSources.length > 0 ? null : 'Primero crea al menos una fuente de ingreso en Catálogos.');
    setIsLoading(false);
  }, [activeDateRange]);

  useEffect(() => {
    if (!activeDateRange) {
      return;
    }

    void loadIncomeData();
  }, [activeDateRange, loadIncomeData]);

  function commitActiveEditorAndRun(action: () => void) {
    const activeElement = document.activeElement;

    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(action);
      });
    }, 0);
  }

  function commitIncomeRows(nextRows: IncomeGridRow[], rowIndex: number | null) {
    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const normalizedRow = normalizeIncomeGridRow(nextRows[rowIndex]);
    const autoSwitchedCurrency = nextRows[rowIndex].currencyCode === 'MXN' && normalizedRow.currencyCode === 'USD';
    const shouldPersist = normalizedRow.isDraft ? canSaveDraftIncomeRow(normalizedRow) : true;
    const validationMessage = shouldPersist ? validateIncomeRow(normalizedRow) : null;
    const updatedRows: IncomeGridRow[] = nextRows.map((row, index) => {
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

  function updateIncomeRow(rowId: string, updates: Partial<IncomeGridRow>) {
    const rowIndex = rowsRef.current.findIndex((row) => row.id === rowId);

    if (rowIndex < 0) {
      return;
    }

    const nextRows = rowsRef.current.map((row, index) => (index === rowIndex ? { ...row, ...updates } : row));
    commitIncomeRows(nextRows, rowIndex);
  }

  const persistIncomeRow = useCallback(
    async (rowId: string) => {
      if (!supabase) {
        setFeedback('Supabase no está disponible para guardar ingresos.');
        return;
      }

      const row = rowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        setFeedback('No se encontró la fila que intentas guardar. Intenta de nuevo.');
        return;
      }

      if (row.isDraft && !canSaveDraftIncomeRow(row)) {
        const draftErrorMessage = formatIncomeIssuesMessage(row);

        setRows((currentRows) => {
          const nextRows: IncomeGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(draftErrorMessage);
        return;
      }

      const validationMessage = validateIncomeRow(row);

      if (validationMessage) {
        setFeedback(validationMessage);
        setRows((currentRows) => {
          const nextRows: IncomeGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        return;
      }

      setRows((currentRows) => {
        const nextRows: IncomeGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });

      const amountOriginal = Number(row.amountOriginal);
      const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
      const payload = {
        entry_date: row.entryDate,
        source_id: row.sourceId,
        currency_code: row.currencyCode,
        amount_original: amountOriginal,
        fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : fxRateToMxn,
        amount_mxn: Number((amountOriginal * fxRateToMxn).toFixed(6)),
        notes: row.notes.trim() || null,
      };

      const result = row.isDraft
        ? await supabase.from('income_entries').insert(payload).select('id').single()
        : await supabase.from('income_entries').update(payload).eq('id', row.persistedId);

      if (result.error) {
        setRows((currentRows) => {
          const nextRows: IncomeGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(`No fue posible guardar el ingreso: ${result.error.message}`);
        return;
      }

      const persistedId = row.isDraft ? result.data?.id ?? null : row.persistedId;

      if (!persistedId) {
        updateIncomeRow(rowId, {
          status: 'error',
          errorMessage: 'No se recibió el identificador del ingreso guardado.',
        });
        setFeedback('No se recibió el identificador del ingreso guardado.');
        return;
      }

      const savedRow: IncomeGridRow = {
        ...normalizeIncomeGridRow(row),
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
        let nextRows: IncomeGridRow[];
        const currentRowIndex = currentRows.findIndex((candidate) => candidate.id === rowId);

        if (!isDateWithinRange(savedRow.entryDate, activeDateRange)) {
          nextRows = withIncomeDraftRow(currentRows.filter((candidate) => candidate.id !== rowId), sources[0]?.id ?? '');
        } else {
          nextRows = withIncomeDraftRow(
            currentRows.map((candidate) => (candidate.id === rowId ? savedRow : candidate)),
            sources[0]?.id ?? '',
          );
        }

        rowsRef.current = nextRows;
        return nextRows;
      });

      setFeedback(row.isDraft ? 'Ingreso guardado correctamente.' : 'Ingreso actualizado correctamente.');
    },
    [activeDateRange, sources],
  );

  const handleDeleteRow = useCallback(
    async (row: IncomeGridRow) => {
      if (row.isDraft) {
        setRows((currentRows) => {
          const nextRows = withIncomeDraftRow(currentRows.filter((candidate) => candidate.id !== row.id), sources[0]?.id ?? '');
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback('Fila de captura reiniciada.');
        return;
      }

      if (!supabase) {
        setFeedback('Supabase no está disponible para eliminar ingresos.');
        return;
      }

      if (!window.confirm('Eliminar este ingreso?')) {
        return;
      }

      const { error } = await supabase.from('income_entries').delete().eq('id', row.persistedId);

      if (error) {
        setFeedback(`No fue posible eliminar el ingreso: ${error.message}`);
        return;
      }

      persistedRowsRef.current.delete(row.id);
      setRows((currentRows) => {
        const nextRows = withIncomeDraftRow(currentRows.filter((candidate) => candidate.id !== row.id), sources[0]?.id ?? '');
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback('Ingreso eliminado correctamente.');
    },
    [sources],
  );

  const handleRevertRow = useCallback((row: IncomeGridRow) => {
    if (row.isDraft) {
      setRows((currentRows) => {
        const nextRows = withIncomeDraftRow(currentRows.filter((candidate) => candidate.id !== row.id), sources[0]?.id ?? '');
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
      const nextRows = withIncomeDraftRow(
        currentRows.map((candidate) => (candidate.id === row.id ? persistedRow : candidate)),
        sources[0]?.id ?? '',
      );
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback('Se restauraron los últimos valores guardados de la fila.');
  }, [sources]);

  const sourceOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Selecciona una fuente' }, ...sources.map((source) => ({ value: source.id, label: source.name }))],
    [sources],
  );
  const sourceFilterOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Todas' }, ...sources.map((source) => ({ value: source.id, label: source.name }))],
    [sources],
  );
  const currencyOptions = useMemo<readonly SelectOption[]>(
    () => [
      { value: 'MXN', label: 'MXN' },
      { value: 'USD', label: 'USD' },
    ],
    [],
  );
  const sourceLabelById = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  const visibleRows = useMemo(() => {
    const draftRow = rows.find((row) => row.isDraft) ?? null;
    const persistedRows = rows.filter((row) => !row.isDraft);

    if (!sourceFilterId) {
      return draftRow ? [draftRow, ...persistedRows] : persistedRows;
    }

    const filteredRows = persistedRows.filter((row) => row.sourceId === sourceFilterId);
    return draftRow ? [draftRow, ...filteredRows] : filteredRows;
  }, [rows, sourceFilterId]);
  const visibleIncomeSummary = useMemo(() => {
    const persistedVisibleRows = visibleRows.filter((row) => !row.isDraft);
    const totalAmount = persistedVisibleRows.reduce((sum, row) => {
      const rowTotal = Number(row.amountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);

    return {
      count: persistedVisibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
    };
  }, [visibleRows]);

  function renderSourceHeaderCell(_props: RenderHeaderCellProps<IncomeGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Fuente</div>
        <AppSelect
          compact
          ariaLabel="Filtrar ingresos por fuente"
          options={sourceFilterOptions}
          value={sourceFilterId}
          placeholder="Todas"
          onChange={setSourceFilterId}
        />
      </div>
    );
  }

  const columns = useMemo<readonly Column<IncomeGridRow>[]>(
    () => [
      {
        key: 'actions',
        name: '',
        width: 72,
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
                        void persistIncomeRow(row.id);
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
              ) : null}
              {!showPrimaryActions ? (
                <button
                  type="button"
                  className={`grid-action ${row.isDraft ? 'grid-action--clear' : 'grid-action--delete'}`}
                  title={row.isDraft ? 'Limpiar' : 'Eliminar'}
                  aria-label={row.isDraft ? 'Limpiar' : 'Eliminar'}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleDeleteRow(row);
                  }}
                >
                  <FontAwesomeIcon icon={row.isDraft ? faEraser : faTrash} />
                </button>
              ) : null}
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
        key: 'sourceId',
        name: 'Fuente',
        width: DEFAULT_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderSourceHeaderCell,
        renderCell: ({ row }) => sourceLabelById.get(row.sourceId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={sourceOptions} />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <SelectCellEditor {...props} options={currencyOptions} />,
      },
      {
        key: 'amountOriginal',
        name: 'Monto original',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0.00" />,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX a MXN',
        width: DEFAULT_COLUMN_WIDTH,
        renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="1.000000" />,
      },
      {
        key: 'amountMxn',
        name: 'Monto MXN',
        width: DEFAULT_COLUMN_WIDTH,
        editable: false,
      },
      {
        key: 'notes',
        name: 'Notas',
        width: DEFAULT_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Detalle opcional" />,
      },
    ],
    [currencyOptions, handleDeleteRow, handleRevertRow, persistIncomeRow, sourceFilterId, sourceFilterOptions, sourceLabelById, sourceOptions],
  );

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;

  const handleNavigateToNextCell = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef,
        columns,
        rows: visibleRows,
        rowIdx,
        columnIdx,
      });
    },
    [columns, visibleRows],
  );

  function handleSelectDateFilter(nextMode: IncomeDateFilterMode) {
    setDateFilterMode(nextMode);
  }

  function handleRowsChange(nextRows: IncomeGridRow[], data: { indexes: number[] }) {
    commitIncomeRows(nextRows, data.indexes[0] ?? null);
  }

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
            <div className="income-period-filter" role="group" aria-label="Filtrar ingresos por fecha">
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'all' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => handleSelectDateFilter('all')}
                disabled={isLoading}
              >
                Todo
              </button>
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'month' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => handleSelectDateFilter('month')}
                disabled={isLoading}
              >
                Este mes
              </button>
              <button
                type="button"
                className={`income-period-filter__button ${dateFilterMode === 'year' ? 'income-period-filter__button--active' : ''}`}
                onClick={() => handleSelectDateFilter('year')}
                disabled={isLoading}
              >
                Este año
              </button>
            </div>
          </div>

          <div className="badge-row" aria-label="Resumen de ingresos visibles">
            <span className="badge">{visibleIncomeSummary.count} regs</span>
            <span className="badge">{visibleIncomeSummary.totalLabel}</span>
          </div>

        </div>

        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}

        {currentErrorMessage ? <div className="feedback-banner feedback-banner--error">{currentErrorMessage}</div> : null}

        <div className="grid-wrapper grid-wrapper--tall">
          <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateToNextCell}>
            <DataGrid
              ref={gridRef}
              columns={columns}
              rows={visibleRows}
              rowHeight={GRID_ROW_HEIGHT}
              headerRowHeight={FILTER_HEADER_ROW_HEIGHT}
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
          </GridEditorNavigationProvider>
        </div>

      </section>
    </div>
  );
}
