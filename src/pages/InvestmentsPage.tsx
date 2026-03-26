import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEraser, faFloppyDisk, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type SortColumn } from 'react-data-grid';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { isIsoDateString } from '../features/shared/isoDate';
import {
  commitActiveEditorAndRun,
  createLocalId,
  formatCurrencyTotal,
  formatEditableNumber,
  getDateRange,
  getTodayDate,
  investmentCurrencyOptions,
  isDateWithinRange,
  isErrorFeedback,
  type InvestmentDateFilterMode,
  type InvestmentEntity,
} from '../features/investments/shared';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type InvestmentMovement = {
  id: string;
  investment_entity_id: string;
  entry_date: string;
  currency_code: 'MXN' | 'USD';
  amount_original: number;
  fx_rate_to_mxn: number | null;
  amount_mxn: number;
  notes: string | null;
  investment_entities: { name: string } | { name: string }[] | null;
};

type InvestmentMovementRow = Omit<InvestmentMovement, 'investment_entities'> & {
  investment_entities: { name: string } | null;
};

type InvestmentGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  entryDate: string;
  entityId: string;
  currencyCode: 'MXN' | 'USD';
  amountOriginal: string;
  fxRateToMxn: string;
  amountMxn: string;
  notes: string;
};

const INVESTMENT_COLUMN_ORDER = ['actions', 'entryDate', 'entityId', 'currencyCode', 'amountOriginal', 'fxRateToMxn', 'amountMxn', 'notes'] as const;

type InvestmentColumnKey = (typeof INVESTMENT_COLUMN_ORDER)[number];

type InstrumentSummaryRow = {
  entityId: string;
  entityName: string;
  depositsLabel: string;
  depositsValue: number;
  withdrawalsLabel: string;
  withdrawalsValue: number;
  netLabel: string;
  netValue: number;
  portfolioWeightLabel: string;
  portfolioWeightValue: number | null;
};

const SUMMARY_GRID_ROW_HEIGHT = 34;
const SUMMARY_COLUMN_ORDER = ['entityName', 'depositsLabel', 'withdrawalsLabel', 'netLabel', 'portfolioWeightLabel'] as const;

type SummaryColumnKey = (typeof SUMMARY_COLUMN_ORDER)[number];

type InstrumentSummaryTotalRow = {
  id: 'total';
  totalDepositsLabel: string;
  totalWithdrawalsLabel: string;
  totalNetLabel: string;
  totalWeightLabel: string;
};

const GRID_ROW_HEIGHT = 30;
const DEFAULT_COLUMN_WIDTH = 108;
const AMOUNT_COLUMN_WIDTH = 96;
const ACTION_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 180;

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

function reorderColumns<T extends string>(order: readonly T[], sourceKey: string, targetKey: string) {
  const sourceIndex = order.findIndex((key) => key === sourceKey);
  const targetIndex = order.findIndex((key) => key === targetKey);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return [...order];
  }

  const nextOrder = [...order];
  const [source] = nextOrder.splice(sourceIndex, 1);
  nextOrder.splice(targetIndex, 0, source);
  return nextOrder as T[];
}

function normalizeInvestmentMovement(row: InvestmentMovement): InvestmentMovementRow {
  const relation = Array.isArray(row.investment_entities) ? row.investment_entities[0] ?? null : row.investment_entities;

  return {
    ...row,
    investment_entities: relation,
  };
}

function createDraftInvestmentRow(): InvestmentGridRow {
  return {
    id: createLocalId('investment-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    entryDate: getTodayDate(),
    entityId: '',
    currencyCode: 'MXN',
    amountOriginal: '',
    fxRateToMxn: '1',
    amountMxn: '',
    notes: '',
  };
}

function withDraftRow(rows: InvestmentGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftInvestmentRow();

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function toInvestmentGridRow(row: InvestmentMovementRow): InvestmentGridRow {
  return {
    id: row.id,
    persistedId: row.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    entryDate: row.entry_date,
    entityId: row.investment_entity_id,
    currencyCode: row.currency_code,
    amountOriginal: formatEditableNumber(row.amount_original),
    fxRateToMxn: formatEditableNumber(row.currency_code === 'MXN' ? 1 : (row.fx_rate_to_mxn ?? 1)),
    amountMxn: formatEditableNumber(row.amount_mxn),
    notes: row.notes ?? '',
  };
}

function normalizeInvestmentGridRow(row: InvestmentGridRow): InvestmentGridRow {
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
  const amountOriginal = Number(row.amountOriginal);
  const fxRate = Number(fxRateToMxn);

  return {
    ...row,
    fxRateToMxn,
    amountMxn:
      Number.isFinite(amountOriginal) && amountOriginal !== 0 && Number.isFinite(fxRate) && fxRate > 0
        ? formatEditableNumber(Number((amountOriginal * fxRate).toFixed(6)))
        : '',
  };
}

function canSaveDraftInvestmentRow(row: InvestmentGridRow) {
  return Boolean(
    row.entryDate.trim() &&
      row.entityId &&
      row.amountOriginal.trim() &&
      (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()),
  );
}

function getInvestmentRowIssues(row: InvestmentGridRow) {
  const issues: string[] = [];

  if (!row.entryDate.trim()) {
    issues.push('captura la fecha');
  } else if (!isIsoDateString(row.entryDate)) {
    issues.push('usa el formato AAAA-MM-DD');
  }

  if (!row.entityId) {
    issues.push('selecciona la entidad');
  }

  const amountOriginal = Number(row.amountOriginal);
  if (!row.amountOriginal.trim()) {
    issues.push('captura el monto');
  } else if (!Number.isFinite(amountOriginal) || amountOriginal === 0) {
    issues.push('usa un monto distinto de cero');
  }

  const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  if (row.currencyCode !== 'MXN' && !row.fxRateToMxn.trim()) {
    issues.push('captura el tipo de cambio');
  } else if (!Number.isFinite(fxRate) || fxRate <= 0) {
    issues.push('usa un tipo de cambio mayor a cero');
  }

  return issues;
}

function formatInvestmentIssuesMessage(row: InvestmentGridRow) {
  const issues = getInvestmentRowIssues(row);

  if (issues.length === 0) {
    return 'Revisa los valores de la fila antes de guardar.';
  }

  return `No se puede guardar el movimiento: ${issues.join(', ')}.`;
}

function validateInvestmentRow(row: InvestmentGridRow) {
  if (!isIsoDateString(row.entryDate)) {
    return 'La fecha debe usar el formato AAAA-MM-DD.';
  }

  if (!row.entityId) {
    return 'Selecciona una entidad.';
  }

  const amountOriginal = Number(row.amountOriginal);
  if (!Number.isFinite(amountOriginal) || amountOriginal === 0) {
    return 'El monto debe ser distinto de cero.';
  }

  const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return 'El tipo de cambio debe ser mayor a cero.';
  }

  return null;
}

export function InvestmentsPage() {
  const [entities, setEntities] = useState<InvestmentEntity[]>([]);
  const [rows, setRows] = useState<InvestmentGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilterMode, setDateFilterMode] = useState<InvestmentDateFilterMode>('year');
  const [investmentColumnOrder, setInvestmentColumnOrder] = useState<readonly InvestmentColumnKey[]>(INVESTMENT_COLUMN_ORDER);
  const [summaryColumnOrder, setSummaryColumnOrder] = useState<readonly SummaryColumnKey[]>(SUMMARY_COLUMN_ORDER);
  const [summarySortColumns, setSummarySortColumns] = useState<readonly SortColumn[]>([]);
  const rowsRef = useRef<InvestmentGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, InvestmentGridRow>>(new Map());
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
      .from('investment_movements')
      .select('id, investment_entity_id, entry_date, currency_code, amount_original, fx_rate_to_mxn, amount_mxn, notes, investment_entities(name)')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('entry_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('entry_date', activeDateRange.end);
    }

    const [{ data: entityData, error: entityError }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('investment_entities').select('id, name').eq('is_active', true).order('name', { ascending: true }),
      entriesQuery,
    ]);

    if (entityError) {
      setFeedback(`No fue posible cargar entidades: ${entityError.message}`);
      setIsLoading(false);
      return;
    }

    if (entryError) {
      setFeedback(`No fue posible cargar movimientos: ${entryError.message}`);
      setIsLoading(false);
      return;
    }

    const nextEntities = (entityData as InvestmentEntity[]) ?? [];
    const nextRows = ((entryData as InvestmentMovement[]) ?? []).map(normalizeInvestmentMovement).map(toInvestmentGridRow);
    const loadedRows = withDraftRow(nextRows);

    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    rowsRef.current = loadedRows;
    setEntities(nextEntities);
    setRows(loadedRows);
    setFeedback(nextEntities.length > 0 ? null : 'Primero crea al menos una entidad de inversion en Catálogos.');
    setIsLoading(false);
  }, [activeDateRange.end, activeDateRange.start]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function handleRowsChange(nextRows: InvestmentGridRow[], data: { indexes: number[] }) {
    const rowIndex = data.indexes[0] ?? null;

    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const normalizedRow = normalizeInvestmentGridRow(nextRows[rowIndex]);
    const shouldPersist = normalizedRow.isDraft ? canSaveDraftInvestmentRow(normalizedRow) : true;
    const validationMessage = shouldPersist ? validateInvestmentRow(normalizedRow) : null;
    const updatedRows: InvestmentGridRow[] = nextRows.map((row, index) => {
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

    if (row.isDraft && !canSaveDraftInvestmentRow(row)) {
      const draftErrorMessage = formatInvestmentIssuesMessage(row);
      setRows((currentRows) => {
        const nextRows: InvestmentGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(draftErrorMessage);
      return;
    }

    const validationMessage = validateInvestmentRow(row);
    if (validationMessage) {
      setRows((currentRows) => {
        const nextRows: InvestmentGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });
      setFeedback(validationMessage);
      return;
    }

    setRows((currentRows) => {
      const nextRows: InvestmentGridRow[] = currentRows.map((candidate) =>
        candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
      );
      rowsRef.current = nextRows;
      return nextRows;
    });

    const amountOriginal = Number(row.amountOriginal);
    const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
    const payload = {
      investment_entity_id: row.entityId,
      entry_date: row.entryDate,
      currency_code: row.currencyCode,
      amount_original: Number(amountOriginal.toFixed(6)),
      fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : Number(fxRateToMxn.toFixed(6)),
      amount_mxn: Number((amountOriginal * fxRateToMxn).toFixed(6)),
      notes: row.notes.trim() || null,
    };

    const result = row.isDraft
      ? await supabase.from('investment_movements').insert(payload).select('id').single()
      : await supabase.from('investment_movements').update(payload).eq('id', row.persistedId);

    if (result.error) {
      setRows((currentRows) => {
        const nextRows: InvestmentGridRow[] = currentRows.map((candidate) =>
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

    const savedRow: InvestmentGridRow = {
      ...normalizeInvestmentGridRow(row),
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

    setFeedback('Movimiento guardado.');
  }, [activeDateRange, entities]);

  const handleDeleteRow = useCallback(async (row: InvestmentGridRow) => {
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

    if (!window.confirm('Eliminar este movimiento?')) {
      return;
    }

    const { error } = await supabase.from('investment_movements').delete().eq('id', row.persistedId);
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
    setFeedback('Movimiento eliminado.');
  }, [entities]);

  const handleRevertRow = useCallback((row: InvestmentGridRow) => {
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
  }, [entities]);

  const entityOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Entidad' }, ...entities.map((entity) => ({ value: entity.id, label: entity.name }))],
    [entities],
  );
  const entityLabelById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity.name])), [entities]);

  const visibleSummary = useMemo(() => {
    const visibleRows = rows.filter((row) => !row.isDraft);
    const deposits = visibleRows.reduce((sum, row) => {
      const amount = Number(row.amountMxn);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);
    const withdrawals = visibleRows.reduce((sum, row) => {
      const amount = Number(row.amountMxn);
      return Number.isFinite(amount) && amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0);
    const net = visibleRows.reduce((sum, row) => {
      const amount = Number(row.amountMxn);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);

    return {
      count: visibleRows.length,
      depositsLabel: formatCurrencyTotal(deposits),
      withdrawalsLabel: formatCurrencyTotal(withdrawals),
      netLabel: formatCurrencyTotal(net),
    };
  }, [rows]);

  const instrumentSummaryRows = useMemo<InstrumentSummaryRow[]>(() => {
    const summaryByEntity = new Map<string, { entityName: string; deposits: number; withdrawals: number; net: number }>();

    for (const row of rows) {
      if (row.isDraft || !row.entityId) {
        continue;
      }

      const amount = Number(row.amountMxn);
      if (!Number.isFinite(amount)) {
        continue;
      }

      const entityName = entityLabelById.get(row.entityId) ?? 'Sin entidad';
      const summary = summaryByEntity.get(row.entityId) ?? {
        entityName,
        deposits: 0,
        withdrawals: 0,
        net: 0,
      };

      if (amount > 0) {
        summary.deposits += amount;
      } else if (amount < 0) {
        summary.withdrawals += Math.abs(amount);
      }

      summary.net += amount;
      summaryByEntity.set(row.entityId, summary);
    }

    const summaryRows = [...summaryByEntity.entries()].map(([entityId, summary]) => ({
      entityId,
      entityName: summary.entityName,
      depositsLabel: formatCurrencyTotal(summary.deposits),
      depositsValue: summary.deposits,
      withdrawalsLabel: formatCurrencyTotal(summary.withdrawals),
      withdrawalsValue: summary.withdrawals,
      netLabel: formatCurrencyTotal(summary.net),
      netValue: summary.net,
      portfolioWeightLabel: '—',
      portfolioWeightValue: null,
    }));

    const totalNet = summaryRows.reduce((sum, row) => sum + row.netValue, 0);

    return summaryRows
      .map((row) => ({
        ...row,
        portfolioWeightValue: totalNet > 0 ? row.netValue / totalNet : null,
        portfolioWeightLabel: formatPercent(totalNet > 0 ? row.netValue / totalNet : null),
      }))
      .sort((left, right) => left.entityName.localeCompare(right.entityName, 'es'));
  }, [entityLabelById, rows]);

  const summaryTotalRow = useMemo<InstrumentSummaryTotalRow>(() => {
    const totalDeposits = instrumentSummaryRows.reduce((sum, row) => sum + row.depositsValue, 0);
    const totalWithdrawals = instrumentSummaryRows.reduce((sum, row) => sum + row.withdrawalsValue, 0);
    const totalNet = instrumentSummaryRows.reduce((sum, row) => sum + row.netValue, 0);
    return {
      id: 'total',
      totalDepositsLabel: formatCurrencyTotal(totalDeposits),
      totalWithdrawalsLabel: formatCurrencyTotal(totalWithdrawals),
      totalNetLabel: formatCurrencyTotal(totalNet),
      totalWeightLabel: totalNet > 0 ? formatPercent(1) : '—',
    };
  }, [instrumentSummaryRows]);

  const sortedInstrumentSummaryRows = useMemo(() => {
    if (summarySortColumns.length === 0) {
      return instrumentSummaryRows;
    }

    return [...instrumentSummaryRows].sort((left, right) => {
      for (const sort of summarySortColumns) {
        const direction = sort.direction === 'ASC' ? 1 : -1;
        let result = 0;

        if (sort.columnKey === 'entityName') {
          result = left.entityName.localeCompare(right.entityName, 'es-MX');
        } else if (sort.columnKey === 'depositsLabel') {
          result = left.depositsValue - right.depositsValue;
        } else if (sort.columnKey === 'withdrawalsLabel') {
          result = left.withdrawalsValue - right.withdrawalsValue;
        } else if (sort.columnKey === 'netLabel') {
          result = left.netValue - right.netValue;
        } else if (sort.columnKey === 'portfolioWeightLabel') {
          const leftValue = left.portfolioWeightValue;
          const rightValue = right.portfolioWeightValue;
          if (leftValue == null && rightValue == null) result = 0;
          else if (leftValue == null) result = 1;
          else if (rightValue == null) result = -1;
          else result = leftValue - rightValue;
        }

        if (result !== 0) {
          return result * direction;
        }
      }

      return 0;
    });
  }, [instrumentSummaryRows, summarySortColumns]);

  const summaryColumnsByKey = useMemo<Record<SummaryColumnKey, Column<InstrumentSummaryRow, InstrumentSummaryTotalRow>>>(() => ({
    entityName: {
      key: 'entityName',
      name: 'Instrumento',
      width: 220,
      draggable: true,
      sortable: true,
      renderSummaryCell: () => <strong>Total</strong>,
    },
    depositsLabel: {
      key: 'depositsLabel',
      name: 'Abonos',
      width: 138,
      draggable: true,
      sortable: true,
      renderSummaryCell: ({ row }) => <strong>{row.totalDepositsLabel}</strong>,
    },
    withdrawalsLabel: {
      key: 'withdrawalsLabel',
      name: 'Retiros',
      width: 138,
      draggable: true,
      sortable: true,
      renderSummaryCell: ({ row }) => <strong>{row.totalWithdrawalsLabel}</strong>,
    },
    netLabel: {
      key: 'netLabel',
      name: 'Neto',
      width: 138,
      draggable: true,
      sortable: true,
      renderSummaryCell: ({ row }) => <strong>{row.totalNetLabel}</strong>,
    },
    portfolioWeightLabel: {
      key: 'portfolioWeightLabel',
      name: 'Peso',
      width: 110,
      draggable: true,
      sortable: true,
      renderSummaryCell: ({ row }) => <strong>{row.totalWeightLabel}</strong>,
    },
  }), []);

  const summaryColumns = useMemo<readonly Column<InstrumentSummaryRow, InstrumentSummaryTotalRow>[]>(
    () => summaryColumnOrder.map((key) => summaryColumnsByKey[key]),
    [summaryColumnOrder, summaryColumnsByKey],
  );

  const investmentColumnsByKey = useMemo<Record<InvestmentColumnKey, Column<InvestmentGridRow>>>(() => ({
    actions: {
      key: 'actions',
      name: '',
      width: ACTION_COLUMN_WIDTH,
      editable: false,
      draggable: true,
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
    entryDate: {
      key: 'entryDate',
      name: 'Fecha',
      width: DEFAULT_COLUMN_WIDTH,
      draggable: true,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
    },
    entityId: {
      key: 'entityId',
      name: 'Entidad',
      width: 170,
      draggable: true,
      renderCell: ({ row }) => entityLabelById.get(row.entityId) ?? '-',
      renderEditCell: (props) => <SelectCellEditor {...props} options={entityOptions} />,
    },
    currencyCode: {
      key: 'currencyCode',
      name: 'Moneda',
      width: 88,
      draggable: true,
      renderEditCell: (props) => <SelectCellEditor {...props} options={investmentCurrencyOptions} />,
    },
    amountOriginal: {
      key: 'amountOriginal',
      name: 'Monto',
      width: AMOUNT_COLUMN_WIDTH,
      draggable: true,
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" step="0.000001" placeholder="1000 o -1000" />,
    },
    fxRateToMxn: {
      key: 'fxRateToMxn',
      name: 'FX',
      width: 86,
      draggable: true,
      renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
      renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="1" />,
    },
    amountMxn: {
      key: 'amountMxn',
      name: 'MXN',
      width: AMOUNT_COLUMN_WIDTH,
      editable: false,
      draggable: true,
    },
    notes: {
      key: 'notes',
      name: 'Notas',
      width: NOTES_COLUMN_WIDTH,
      draggable: true,
      renderEditCell: (props) => <InputCellEditor {...props} placeholder="Opcional" />,
    },
  }), [entityLabelById, entityOptions, handleDeleteRow, handleRevertRow, persistRow]);

  const columns = useMemo<readonly Column<InvestmentGridRow>[]>(
    () => investmentColumnOrder.map((key) => investmentColumnsByKey[key]),
    [investmentColumnOrder, investmentColumnsByKey],
  );

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
            <div className="income-period-filter" role="group" aria-label="Filtrar movimientos de inversion por fecha">
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

          <div className="badge-row" aria-label="Resumen de movimientos de inversion visibles">
            <span className="badge">+ abono / - retiro</span>
            <span className="badge">{visibleSummary.count} regs</span>
            <span className="badge">Abonos {visibleSummary.depositsLabel}</span>
            <span className="badge">Retiros {visibleSummary.withdrawalsLabel}</span>
            <span className="badge">Neto {visibleSummary.netLabel}</span>
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
              if (!args.row || args.rowIdx < 0) {
                return;
              }

              if (args.column.renderEditCell) {
                args.selectCell(true);
              }
            }}
            onSelectedCellChange={(args) => {
              if (args.rowIdx < 0) {
                return;
              }

              if (args.row && args.column.renderEditCell) {
                focusCellEditor(args.rowIdx, args.column.idx, args.column.key);
              }
            }}
            defaultColumnOptions={{ resizable: true, draggable: true }}
            onColumnsReorder={(sourceColumnKey, targetColumnKey) => {
              setInvestmentColumnOrder((currentOrder) => reorderColumns(currentOrder, sourceColumnKey, targetColumnKey));
            }}
            rowClass={(row) => {
              if (row.status === 'saving') return 'row-saving';
              if (row.status === 'error') return 'row-error';
              if (row.status === 'new') return 'row-new';
              if (row.status === 'dirty') return 'row-dirty';
              return 'row-saved';
            }}
            style={{ blockSize: 600 }}
          />
        </div>

        {instrumentSummaryRows.length > 0 ? (
          <div className="finance-panel__summary">
            <div className="finance-panel__header">
              <div className="badge-row" aria-label="Resumen por instrumento">
                <span className="badge">{instrumentSummaryRows.length} instrumentos</span>
              </div>
            </div>

            <div className="grid-wrapper">
              <DataGrid
                columns={summaryColumns}
                rows={sortedInstrumentSummaryRows}
                rowHeight={SUMMARY_GRID_ROW_HEIGHT}
                headerRowHeight={SUMMARY_GRID_ROW_HEIGHT}
                rowKeyGetter={(row) => row.entityId}
                defaultColumnOptions={{ resizable: true, draggable: true }}
                sortColumns={summarySortColumns}
                onSortColumnsChange={setSummarySortColumns}
                onColumnsReorder={(sourceColumnKey, targetColumnKey) => {
                  setSummaryColumnOrder((currentOrder) => reorderColumns(currentOrder, sourceColumnKey, targetColumnKey));
                }}
                topSummaryRows={[summaryTotalRow]}
                bottomSummaryRows={[summaryTotalRow]}
                rowClass={() => 'row-saved'}
                style={{ blockSize: Math.min(800, Math.max(188, (sortedInstrumentSummaryRows.length + 3) * SUMMARY_GRID_ROW_HEIGHT + 2)) }}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
