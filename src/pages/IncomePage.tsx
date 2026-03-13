import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle } from 'react-data-grid';
import { ENABLE_MOBILE_OPTIMIZED_LAYOUTS } from '../config/ui';
import { AppDatePicker } from '../features/shared/AppDatePicker';
import { AppSelect, InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { isIsoDateString, ISO_DATE_PLACEHOLDER } from '../features/shared/isoDate';
import { useMediaQuery } from '../features/shared/useMediaQuery';
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

function normalizeIncomeEntry(row: IncomeEntryRow): IncomeEntry {
  const relation = Array.isArray(row.income_sources) ? row.income_sources[0] ?? null : row.income_sources;

  return {
    ...row,
    income_sources: relation,
  };
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
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
const GRID_ROW_HEIGHT = 32;

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
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
  const parsedAmount = Number(row.amountOriginal);
  const parsedFxRate = Number(fxRateToMxn);

  return {
    ...row,
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

function getIncomeStatusLabel(row: IncomeGridRow) {
  switch (row.status) {
    case 'saving':
      return 'Guardando';
    case 'dirty':
      return 'Pendiente';
    case 'error':
      return 'Error';
    case 'saved':
      return 'Guardado';
    default:
      return 'Nuevo';
  }
}

function formatIncomeMxnValue(value: string) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 'Pendiente';
  }

  return `MXN ${parsedValue.toFixed(2)}`;
}

const MOBILE_VISIBLE_ROW_COUNT = 4;

export function IncomePage() {
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [rows, setRows] = useState<IncomeGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [showAllMobileRows, setShowAllMobileRows] = useState(false);
  const rowsRef = useRef<IncomeGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, IncomeGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);
  const matchesMobile = useMediaQuery('(max-width: 768px)');
  const isMobile = ENABLE_MOBILE_OPTIMIZED_LAYOUTS && matchesMobile;

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedRowId(null);
      return;
    }

    if (!selectedRowId || !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]?.id ?? null);
    }
  }, [rows, selectedRowId]);

  const loadIncomeData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no esta configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    const [{ data: sourceData, error: sourceError }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('income_sources').select('id, name').order('name', { ascending: true }),
      supabase
        .from('income_entries')
        .select('id, source_id, entry_date, currency_code, amount_original, fx_rate_to_mxn, amount_mxn, notes, income_sources(name)')
        .order('entry_date', { ascending: false })
        .limit(24),
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

    const loadedRows = [createDraftIncomeRow(nextSources[0]?.id ?? ''), ...nextRows];

    rowsRef.current = loadedRows;
    setSources(nextSources);
    setRows(loadedRows);
    setFeedback(nextSources.length > 0 ? null : 'Primero crea al menos una fuente de ingreso en Catalogos.');
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadIncomeData();
  }, [loadIncomeData]);

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
        setFeedback('Supabase no esta disponible para guardar ingresos.');
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
        ? await supabase.from('income_entries').insert(payload)
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

      setFeedback(row.isDraft ? 'Ingreso guardado correctamente.' : 'Ingreso actualizado correctamente.');
      await loadIncomeData();
    },
    [loadIncomeData],
  );

  const handleDeleteRow = useCallback(
    async (row: IncomeGridRow) => {
      if (row.isDraft) {
        setRows((currentRows) => {
          const nextRows = [createDraftIncomeRow(sources[0]?.id ?? ''), ...currentRows.filter((candidate) => !candidate.isDraft)];
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback('Fila de captura reiniciada.');
        return;
      }

      if (!supabase) {
        setFeedback('Supabase no esta disponible para eliminar ingresos.');
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

      setFeedback('Ingreso eliminado correctamente.');
      await loadIncomeData();
    },
    [loadIncomeData, sources],
  );

  const handleRevertRow = useCallback((row: IncomeGridRow) => {
    if (row.isDraft) {
      setRows((currentRows) => {
        const nextRows = [createDraftIncomeRow(sources[0]?.id ?? ''), ...currentRows.filter((candidate) => !candidate.isDraft)];
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
      const nextRows = currentRows.map((candidate) => (candidate.id === row.id ? persistedRow : candidate));
      rowsRef.current = nextRows;
      return nextRows;
    });
    setFeedback('Se restauraron los ultimos valores guardados de la fila.');
  }, [sources]);

  const sourceOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Selecciona una fuente' }, ...sources.map((source) => ({ value: source.id, label: source.name }))],
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

  const columns = useMemo<readonly Column<IncomeGridRow>[]>(
    () => [
      {
        key: 'actions',
        name: '',
        width: 78,
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
    [currencyOptions, handleDeleteRow, handleRevertRow, persistIncomeRow, sourceLabelById, sourceOptions],
  );

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;
  const selectedMobileRow = rows.find((row) => row.id === selectedRowId) ?? rows[0] ?? null;
  const mobileErrorMessage = selectedMobileRow?.errorMessage ?? currentErrorMessage;
  const mobileListRows = useMemo(() => {
    if (!selectedMobileRow) {
      return rows;
    }

    const draftRow = rows.find((row) => row.isDraft) ?? null;
    const orderedIds = [selectedMobileRow.id, draftRow?.id].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
    const prioritizedRows = orderedIds
      .map((id) => rows.find((row) => row.id === id) ?? null)
      .filter((row): row is IncomeGridRow => row != null);
    const remainingRows = rows.filter((row) => !orderedIds.includes(row.id));

    return [...prioritizedRows, ...remainingRows];
  }, [rows, selectedMobileRow]);
  const visibleMobileRows = showAllMobileRows ? mobileListRows : mobileListRows.slice(0, MOBILE_VISIBLE_ROW_COUNT);

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
        {feedback ? <div className="feedback-banner feedback-banner--error">{feedback}</div> : null}

        {isMobile ? (
          <div className="mobile-income">
            <div className="mobile-income__picker">
              <div className="mobile-income__picker-header">
                <span>
                  {visibleMobileRows.length} de {rows.length}
                </span>
              </div>
              <div className="mobile-income__picker-list">
                {visibleMobileRows.map((row) => {
                  const sourceLabel = row.isDraft ? 'Nuevo' : (sourceLabelById.get(row.sourceId) ?? 'Sin fuente');
                  const compactStatus = row.status === 'saved' ? null : getIncomeStatusLabel(row);

                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`mobile-income__chip ${row.id === selectedMobileRow?.id ? 'mobile-income__chip--active' : ''}`}
                      onClick={() => setSelectedRowId(row.id)}
                    >
                      <span className="mobile-income__chip-line">
                        <span className="mobile-income__chip-title">{sourceLabel}</span>
                        <span className="mobile-income__chip-date">{row.entryDate || 'Sin fecha'}</span>
                        <span className="mobile-income__chip-amount">{formatIncomeMxnValue(row.amountMxn)}</span>
                        {compactStatus ? (
                          <span className={`mobile-income__chip-state mobile-income__chip-state--${row.status}`}>{compactStatus}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {rows.length > MOBILE_VISIBLE_ROW_COUNT ? (
                <button
                  type="button"
                  className="mobile-income__toggle"
                  onClick={() => setShowAllMobileRows((currentValue) => !currentValue)}
                >
                  {showAllMobileRows ? 'Ver menos' : 'Ver mas'}
                </button>
              ) : null}
            </div>

            {selectedMobileRow ? (
              <div className="mobile-income__editor">
                <div className="mobile-income__editor-header">
                  <span className={`status-pill status-pill--${selectedMobileRow.status === 'error' ? 'checking' : 'ok'}`}>
                    {getIncomeStatusLabel(selectedMobileRow)}
                  </span>
                </div>

                {mobileErrorMessage ? <div className="feedback-banner feedback-banner--error">{mobileErrorMessage}</div> : null}

                <div className="mobile-form">
                  <label className="mobile-form__field">
                    <span>Fecha</span>
                    <AppDatePicker
                      ariaLabel="Fecha"
                      className="mobile-form__control"
                      value={selectedMobileRow.entryDate}
                      onChange={(value) => updateIncomeRow(selectedMobileRow.id, { entryDate: value })}
                      placeholder={ISO_DATE_PLACEHOLDER}
                    />
                  </label>

                  <label className="mobile-form__field">
                    <span>Fuente</span>
                    <AppSelect
                      ariaLabel="Fuente"
                      options={sourceOptions}
                      value={selectedMobileRow.sourceId}
                      onChange={(value) => updateIncomeRow(selectedMobileRow.id, { sourceId: value })}
                    />
                  </label>

                  <div className="mobile-form__split">
                    <label className="mobile-form__field">
                      <span>Moneda</span>
                      <AppSelect
                        ariaLabel="Moneda"
                        options={currencyOptions}
                        value={selectedMobileRow.currencyCode}
                        onChange={(value) => updateIncomeRow(selectedMobileRow.id, { currencyCode: value as 'MXN' | 'USD' })}
                        isSearchable={false}
                      />
                    </label>

                    <label className="mobile-form__field">
                      <span>Monto original</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={selectedMobileRow.amountOriginal}
                        placeholder="0.00"
                        onChange={(event) => updateIncomeRow(selectedMobileRow.id, { amountOriginal: event.target.value })}
                      />
                    </label>
                  </div>

                  {selectedMobileRow.currencyCode === 'MXN' ? (
                    <div className="mobile-income__computed">
                      <span>Tipo de cambio</span>
                      <strong>1.00</strong>
                    </div>
                  ) : (
                    <label className="mobile-form__field">
                      <span>Tipo de cambio a MXN</span>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={selectedMobileRow.fxRateToMxn}
                        placeholder="1.000000"
                        onChange={(event) => updateIncomeRow(selectedMobileRow.id, { fxRateToMxn: event.target.value })}
                      />
                    </label>
                  )}

                  <div className="mobile-income__computed">
                    <span>Monto calculado en MXN</span>
                    <strong>{formatIncomeMxnValue(selectedMobileRow.amountMxn)}</strong>
                  </div>

                  <label className="mobile-form__field">
                    <span>Notas</span>
                    <textarea
                      rows={4}
                      value={selectedMobileRow.notes}
                      placeholder="Detalle opcional"
                      onChange={(event) => updateIncomeRow(selectedMobileRow.id, { notes: event.target.value })}
                    />
                  </label>
                </div>

                <div className="mobile-form__actions">
                  <button
                    type="button"
                    className="mobile-form__button mobile-form__button--primary"
                    onClick={() => {
                      void persistIncomeRow(selectedMobileRow.id);
                    }}
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="mobile-form__button"
                    onClick={() => {
                      handleRevertRow(selectedMobileRow);
                    }}
                  >
                    {selectedMobileRow.isDraft ? 'Limpiar' : 'Revertir'}
                  </button>
                  <button
                    type="button"
                    className="mobile-form__button mobile-form__button--danger"
                    onClick={() => {
                      void handleDeleteRow(selectedMobileRow);
                    }}
                  >
                    {selectedMobileRow.isDraft ? 'Descartar' : 'Eliminar'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
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
          </>
        )}

      </section>
    </div>
  );
}
