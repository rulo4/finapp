import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalculator, faCopy, faEraser, faFilterCircleXmark, faFloppyDisk, faPlus, faReceipt, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type RenderHeaderCellProps } from 'react-data-grid';
import { Link } from 'react-router-dom';
import { AppDatePicker } from '../features/shared/AppDatePicker';
import {
  AppSelect,
  FX_AUTO_SWITCH_FEEDBACK,
  autoSwitchCurrencyFromFx,
  type SelectOption,
} from '../features/shared/gridEditors';
import {
  getTodayIsoDate,
  isIsoDateString,
} from '../features/shared/isoDate';
import { createCurrentPeriodSelection, getPeriodDateRange, type PeriodFilterSelection, PeriodFilter } from '../features/shared/PeriodFilter';
import { useMediaQuery } from '../features/shared/useMediaQuery';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type ExpenseCategory = {
  id: string;
  name: string;
};

type PaymentInstrument = {
  id: string;
  name: string;
};

type Store = {
  id: string;
  name: string;
};

type UnitOfMeasure = {
  id: string;
  name: string;
};

type ExpenseEntry = {
  id: string;
  entry_date: string;
  concept: string;
  quantity: number;
  unit_of_measure_id: string | null;
  unit_of_measure: string | null;
  subtotal_original: number | null;
  fx_rate_to_mxn: number | null;
  total_amount_mxn: number;
  currency_code: 'MXN' | 'USD';
  category_id: string | null;
  payment_instrument_id: string | null;
  store_id: string | null;
  ticket_url: string | null;
  notes: string | null;
  expense_categories: { name: string } | null;
  payment_instruments: { name: string } | null;
  stores: { name: string } | null;
};

type ExpenseEntryRow = Omit<ExpenseEntry, 'expense_categories' | 'payment_instruments' | 'stores'> & {
  expense_categories: { name: string } | { name: string }[] | null;
  payment_instruments: { name: string } | { name: string }[] | null;
  stores: { name: string } | { name: string }[] | null;
};

type ExpenseGridRow = {
  id: string;
  persistedId: string | null;
  isDraft: boolean;
  status: 'new' | 'saved' | 'dirty' | 'error' | 'saving';
  errorMessage: string | null;
  entryDate: string;
  concept: string;
  quantity: string;
  unitOfMeasureId: string;
  categoryId: string;
  paymentInstrumentId: string;
  storeId: string;
  ticketUrl: string;
  ticketId: string | null;
  currencyCode: 'MXN' | 'USD';
  subtotalOriginal: string;
  fxRateToMxn: string;
  totalAmountMxn: string;
  notes: string;
};

type ExpenseTableFilters = {
  entryDate: string;
  concept: string;
  categoryId: string;
  paymentInstrumentId: string;
  storeId: string;
};

function pickRelation(relation: { name: string } | { name: string }[] | null) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function normalizeExpenseEntry(row: ExpenseEntryRow): ExpenseEntry {
  return {
    ...row,
    expense_categories: pickRelation(row.expense_categories),
    payment_instruments: pickRelation(row.payment_instruments),
    stores: pickRelation(row.stores),
  };
}

function getTodayDate() {
  return getTodayIsoDate();
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

function isErrorFeedback(message: string) {
  const normalizedMessage = message.trim();

  return (
    /^(no\b|supabase\b|necesitas\b|primero\b|la fecha\b|la fila\b|el\b|la\b|selecciona\b|captura\b|este\b)/i.test(
      normalizedMessage,
    ) || /no se pudo/i.test(normalizedMessage)
  );
}

const DATE_COLUMN_WIDTH = 88;
const CONCEPT_COLUMN_WIDTH = 200;
const QUANTITY_COLUMN_WIDTH = 64;
const UNIT_COLUMN_WIDTH = 72;
const SUBTOTAL_COLUMN_WIDTH = 72;
const CATEGORY_COLUMN_WIDTH = 96;
const PAYMENT_COLUMN_WIDTH = 88;
const STORE_COLUMN_WIDTH = 72;
const CURRENCY_COLUMN_WIDTH = 64;
const FX_COLUMN_WIDTH = 64;
const TOTAL_COLUMN_WIDTH = 72;
const NOTES_COLUMN_WIDTH = 120;
const GRID_ROW_HEIGHT = 30;
const FILTER_HEADER_ROW_HEIGHT = 64;
const EXPENSE_ENTRIES_PAGE_SIZE = 1000;
const EXPENSE_ENTRY_SELECT =
  'id, entry_date, concept, quantity, unit_of_measure_id, unit_of_measure, subtotal_original, total_amount_mxn, currency_code, fx_rate_to_mxn, category_id, payment_instrument_id, store_id, ticket_url, notes, expense_categories(name), payment_instruments(name), stores(name)';

function formatEditableNumber(value: number | null | undefined) {
  if (value == null) {
    return '';
  }

  return String(Number(value));
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftExpenseRow(): ExpenseGridRow {
  return {
    id: createLocalId('expense-draft'),
    persistedId: null,
    isDraft: true,
    status: 'new',
    errorMessage: null,
    entryDate: getTodayDate(),
    concept: '',
    quantity: '1',
    unitOfMeasureId: '',
    categoryId: '',
    paymentInstrumentId: '',
    storeId: '',
    ticketUrl: '',
    ticketId: null,
    currencyCode: 'MXN',
    subtotalOriginal: '0',
    fxRateToMxn: '1',
    totalAmountMxn: '',
    notes: '',
  };
}

function canEditExpenseColumn(row: ExpenseGridRow, columnKey: string) {
  if (!row.ticketUrl) {
    return true;
  }

  return columnKey !== 'entryDate' && columnKey !== 'paymentInstrumentId' && columnKey !== 'storeId';
}

function withExpenseDraftRow(rows: ExpenseGridRow[]) {
  const draftRow = rows.find((row) => row.isDraft) ?? createDraftExpenseRow();

  return [draftRow, ...rows.filter((row) => !row.isDraft)];
}

function formatCurrencyTotal(value: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(value);
}

function toExpenseGridRow(entry: ExpenseEntry, ticketId: string | null): ExpenseGridRow {
  return {
    id: entry.id,
    persistedId: entry.id,
    isDraft: false,
    status: 'saved',
    errorMessage: null,
    entryDate: entry.entry_date,
    concept: entry.concept,
    quantity: formatEditableNumber(entry.quantity),
    unitOfMeasureId: entry.unit_of_measure_id ?? '',
    categoryId: entry.category_id ?? '',
    paymentInstrumentId: entry.payment_instrument_id ?? '',
    storeId: entry.store_id ?? '',
    ticketUrl: entry.ticket_url ?? '',
    ticketId,
    currencyCode: entry.currency_code,
    subtotalOriginal: formatEditableNumber(entry.subtotal_original),
    fxRateToMxn: formatEditableNumber(entry.currency_code === 'MXN' ? 1 : (entry.fx_rate_to_mxn ?? 1)),
    totalAmountMxn: formatEditableNumber(entry.total_amount_mxn),
    notes: entry.notes ?? '',
  };
}

async function fetchAllExpenseEntries(activeDateRange: { start: string; end: string }) {
  if (!supabase) {
    return {
      data: null as ExpenseEntryRow[] | null,
      error: new Error('Supabase no está disponible.'),
    };
  }

  const allRows: ExpenseEntryRow[] = [];
  let lastEntryDate: string | null = null;
  let lastId: string | null = null;

  while (true) {
    let query = supabase
      .from('expense_entries')
      .select(EXPENSE_ENTRY_SELECT)
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(EXPENSE_ENTRIES_PAGE_SIZE);

    if (activeDateRange.start) {
      query = query.gte('entry_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      query = query.lte('entry_date', activeDateRange.end);
    }

    if (lastEntryDate && lastId) {
      query = query.or(`entry_date.lt.${lastEntryDate},and(entry_date.eq.${lastEntryDate},id.lt.${lastId})`);
    }

    const { data, error } = await query;

    if (error) {
      return {
        data: null as ExpenseEntryRow[] | null,
        error,
      };
    }

    const batchRows = (data as ExpenseEntryRow[]) ?? [];
    allRows.push(...batchRows);

    if (batchRows.length < EXPENSE_ENTRIES_PAGE_SIZE) {
      break;
    }

    const lastRow = batchRows[batchRows.length - 1];
    lastEntryDate = lastRow?.entry_date ?? null;
    lastId = lastRow?.id ?? null;
  }

  return {
    data: allRows,
    error: null,
  };
}

function normalizeExpenseGridRow(row: ExpenseGridRow): ExpenseGridRow {
  const nextRow = autoSwitchCurrencyFromFx(row);
  const fxRateToMxn = nextRow.currencyCode === 'MXN' ? '1' : nextRow.fxRateToMxn;
  const parsedSubtotal = Number(nextRow.subtotalOriginal);
  const parsedFxRate = Number(fxRateToMxn);

  return {
    ...nextRow,
    fxRateToMxn,
    totalAmountMxn:
      Number.isFinite(parsedSubtotal) &&
      Number.isFinite(parsedFxRate) &&
      parsedFxRate > 0
        ? formatEditableNumber(Number((parsedSubtotal * parsedFxRate).toFixed(6)))
        : '',
  };
}

function canSaveDraftExpenseRow(row: ExpenseGridRow) {
  return Boolean(
    row.concept.trim() &&
      row.quantity.trim() &&
      row.entryDate.trim() &&
      row.subtotalOriginal.trim() &&
      (row.currencyCode === 'MXN' || row.fxRateToMxn.trim()),
  );
}

function getExpenseRowIssues(row: ExpenseGridRow) {
  const issues: string[] = [];

  if (!row.entryDate) {
    issues.push('captura la fecha');
  } else if (!isIsoDateString(row.entryDate)) {
    issues.push('usa el formato AAAA-MM-DD');
  }

  if (!row.concept.trim()) {
    issues.push('captura un concepto');
  }

  const parsedQuantity = Number(row.quantity);

  if (!row.quantity.trim()) {
    issues.push('captura la cantidad');
  } else if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    issues.push('usa una cantidad mayor a cero');
  }

  const parsedSubtotal = Number(row.subtotalOriginal);

  if (!row.subtotalOriginal.trim()) {
    issues.push('captura el subtotal');
  } else if (!Number.isFinite(parsedSubtotal)) {
    issues.push('usa un subtotal numerico valido');
  }

  const parsedFxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

  if (row.currencyCode !== 'MXN' && !row.fxRateToMxn.trim()) {
    issues.push('captura el tipo de cambio');
  } else if (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0) {
    issues.push('usa un tipo de cambio mayor a cero');
  }

  return issues;
}

function formatExpenseIssuesMessage(row: ExpenseGridRow) {
  const issues = getExpenseRowIssues(row);

  if (issues.length === 0) {
    return 'Revisa los valores de la fila antes de guardar.';
  }

  return `No se puede guardar el egreso: ${issues.join(', ')}.`;
}

function evaluateArithmeticExpression(expression: string) {
  const source = expression.replace(/\s+/g, '');

  if (!source) {
    return { value: null as number | null, error: null as string | null };
  }

  if (!/^[0-9()+\-*/.]+$/.test(source)) {
    return { value: null, error: 'Usa solo numeros, parentesis y + - * /' };
  }

  let index = 0;

  function parseExpression(): number {
    let value = parseTerm();

    while (index < source.length) {
      const operator = source[index];

      if (operator !== '+' && operator !== '-') {
        break;
      }

      index += 1;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();

    while (index < source.length) {
      const operator = source[index];

      if (operator !== '*' && operator !== '/') {
        break;
      }

      index += 1;
      const right = parseFactor();

      if (operator === '/') {
        if (right === 0) {
          throw new Error('No se puede dividir entre cero');
        }

        value /= right;
      } else {
        value *= right;
      }
    }

    return value;
  }

  function parseFactor(): number {
    if (source[index] === '+') {
      index += 1;
      return parseFactor();
    }

    if (source[index] === '-') {
      index += 1;
      return -parseFactor();
    }

    if (source[index] === '(') {
      index += 1;
      const value = parseExpression();

      if (source[index] !== ')') {
        throw new Error('Falta cerrar un parentesis');
      }

      index += 1;
      return value;
    }

    const start = index;

    while (index < source.length && /[0-9.]/.test(source[index])) {
      index += 1;
    }

    if (start === index) {
      throw new Error('Expresión inválida');
    }

    const token = source.slice(start, index);

    if ((token.match(/\./g) ?? []).length > 1) {
      throw new Error('Numero invalido');
    }

    const value = Number(token);

    if (!Number.isFinite(value)) {
      throw new Error('Numero invalido');
    }

    return value;
  }

  try {
    const value = parseExpression();

    if (index !== source.length) {
      return { value: null, error: 'Expresión inválida' };
    }

    return { value, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Expresión inválida',
    };
  }
}

function validateExpenseRow(row: ExpenseGridRow) {
  if (!isIsoDateString(row.entryDate)) {
    return 'La fecha debe usar el formato AAAA-MM-DD.';
  }

  if (!row.concept.trim()) {
    return 'El concepto es obligatorio.';
  }

  const parsedQuantity = Number(row.quantity);

  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    return 'La cantidad debe ser mayor a cero.';
  }

  const parsedSubtotal = Number(row.subtotalOriginal);

  if (!Number.isFinite(parsedSubtotal)) {
    return 'El subtotal debe ser numerico.';
  }

  const parsedFxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

  if (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0) {
    return 'El tipo de cambio debe ser mayor a cero.';
  }

  return null;
}

export function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [paymentInstruments, setPaymentInstruments] = useState<PaymentInstrument[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [unitsOfMeasure, setUnitsOfMeasure] = useState<UnitOfMeasure[]>([]);
  const [rows, setRows] = useState<ExpenseGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<PeriodFilterSelection>(() => createCurrentPeriodSelection());
  const [tableFilters, setTableFilters] = useState<ExpenseTableFilters>({
    entryDate: '',
    concept: '',
    categoryId: '',
    paymentInstrumentId: '',
    storeId: '',
  });
  const [calculatorExpression, setCalculatorExpression] = useState('');
  const [isSubtotalCalculatorOpen, setIsSubtotalCalculatorOpen] = useState(false);
  const [activeExpenseId, setActiveExpenseId] = useState<string | null>(null);
  const [mobilePrimaryPanel, setMobilePrimaryPanel] = useState<'capture' | 'history'>('capture');
  const rowsRef = useRef<ExpenseGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, ExpenseGridRow>>(new Map());
  const gridRef = useRef<DataGridHandle>(null);
  const isNarrowViewport = useMediaQuery('(max-width: 720px)');

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      if (activeExpenseId !== null) {
        setActiveExpenseId(null);
      }
      return;
    }

    if (activeExpenseId && rows.some((row) => row.id === activeExpenseId)) {
      return;
    }

    setActiveExpenseId(rows.find((row) => row.isDraft)?.id ?? rows[0]?.id ?? null);
  }, [activeExpenseId, rows]);

  useEffect(() => {
    setIsSubtotalCalculatorOpen(false);
  }, [activeExpenseId]);

  const activeDateRange = useMemo(
    () =>
      getPeriodDateRange(dateFilter, {
        clampCurrentMonthToToday: true,
        clampCurrentYearToToday: true,
      }),
    [dateFilter],
  );

  const loadExpenseData = useCallback(async () => {
    if (!activeDateRange) {
      return;
    }

    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no está configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    const [categoriesResult, instrumentsResult, storesResult, unitsResult, entriesResult] = await Promise.all([
      supabase.from('expense_categories').select('id, name').order('name', { ascending: true }),
      supabase.from('payment_instruments').select('id, name').order('name', { ascending: true }),
      supabase.from('stores').select('id, name').order('name', { ascending: true }),
      supabase.from('unit_of_measures').select('id, name').order('name', { ascending: true }),
      fetchAllExpenseEntries(activeDateRange),
    ]);

    if (categoriesResult.error) {
      setFeedback(`No fue posible cargar categorías: ${categoriesResult.error.message}`);
      setIsLoading(false);
      return;
    }

    if (instrumentsResult.error) {
      setFeedback(`No fue posible cargar instrumentos de pago: ${instrumentsResult.error.message}`);
      setIsLoading(false);
      return;
    }

    if (storesResult.error) {
      setFeedback(`No fue posible cargar tiendas: ${storesResult.error.message}`);
      setIsLoading(false);
      return;
    }

    if (unitsResult.error) {
      setFeedback(`No fue posible cargar unidades de medida: ${unitsResult.error.message}`);
      setIsLoading(false);
      return;
    }

    if (entriesResult.error) {
      setFeedback(`No fue posible cargar egresos: ${entriesResult.error.message}`);
      setIsLoading(false);
      return;
    }

    const normalizedEntries = ((entriesResult.data as ExpenseEntryRow[]) ?? []).map(normalizeExpenseEntry);
    const nextRows = normalizedEntries.map((entry) => toExpenseGridRow(entry, entry.ticket_url ?? null));
    persistedRowsRef.current = new Map(nextRows.map((row) => [row.id, row]));
    const loadedRows = withExpenseDraftRow(nextRows);

    rowsRef.current = loadedRows;
    setCategories((categoriesResult.data as ExpenseCategory[]) ?? []);
    setPaymentInstruments((instrumentsResult.data as PaymentInstrument[]) ?? []);
    setStores((storesResult.data as Store[]) ?? []);
    setUnitsOfMeasure((unitsResult.data as UnitOfMeasure[]) ?? []);
    setRows(loadedRows);
      setActiveExpenseId(loadedRows.find((row) => row.isDraft)?.id ?? loadedRows[0]?.id ?? null);
    setFeedback(null);
    setIsLoading(false);
  }, [activeDateRange]);

  useEffect(() => {
    if (!activeDateRange) {
      return;
    }

    void loadExpenseData();
  }, [activeDateRange, loadExpenseData]);

  function commitExpenseRows(nextRows: ExpenseGridRow[], rowIndex: number | null) {
    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const normalizedRow = normalizeExpenseGridRow(nextRows[rowIndex]);
    const autoSwitchedCurrency = nextRows[rowIndex].currencyCode === 'MXN' && normalizedRow.currencyCode === 'USD';
    const shouldPersist = normalizedRow.isDraft ? canSaveDraftExpenseRow(normalizedRow) : true;
    const validationMessage = shouldPersist ? validateExpenseRow(normalizedRow) : null;
    const updatedRows: ExpenseGridRow[] = nextRows.map((row, index) => {
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

  function updateExpenseRow(rowId: string, updates: Partial<ExpenseGridRow>) {
    const rowIndex = rowsRef.current.findIndex((row) => row.id === rowId);

    if (rowIndex < 0) {
      return;
    }

    const nextRows = rowsRef.current.map((row, index) => (index === rowIndex ? { ...row, ...updates } : row));
    commitExpenseRows(nextRows, rowIndex);
  }

  const persistExpenseRow = useCallback(
    async (rowId: string) => {
      if (!supabase) {
        setFeedback('Supabase no está disponible para guardar egresos.');
        return;
      }

      const row = rowsRef.current.find((candidate) => candidate.id === rowId);

      if (!row) {
        setFeedback('No se encontró la fila que intentas guardar. Intenta de nuevo.');
        return;
      }

      if (row.isDraft && !canSaveDraftExpenseRow(row)) {
        const draftErrorMessage = formatExpenseIssuesMessage(row);

        setRows((currentRows) => {
          const nextRows: ExpenseGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: draftErrorMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(draftErrorMessage);
        return;
      }

      const validationMessage = validateExpenseRow(row);

      if (validationMessage) {
        setFeedback(validationMessage);
        setRows((currentRows) => {
          const nextRows: ExpenseGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: validationMessage } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        return;
      }

      setRows((currentRows) => {
        const nextRows: ExpenseGridRow[] = currentRows.map((candidate) =>
          candidate.id === rowId ? { ...candidate, status: 'saving', errorMessage: null } : candidate,
        );
        rowsRef.current = nextRows;
        return nextRows;
      });

      const subtotalOriginal = Number(row.subtotalOriginal);
      const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
      const selectedUnit = unitsOfMeasure.find((unit) => unit.id === row.unitOfMeasureId) ?? null;
      const payload = {
        entry_date: row.entryDate,
        concept: row.concept.trim(),
        quantity: Number(row.quantity),
        unit_of_measure: selectedUnit?.name ?? null,
        unit_of_measure_id: row.unitOfMeasureId || null,
        subtotal_original: Number(subtotalOriginal.toFixed(6)),
        currency_code: row.currencyCode,
        fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : fxRateToMxn,
        total_amount_mxn: Number((subtotalOriginal * fxRateToMxn).toFixed(6)),
        payment_instrument_id: row.paymentInstrumentId || null,
        store_id: row.storeId || null,
        category_id: row.categoryId || null,
        ticket_url: row.ticketUrl || null,
        notes: row.notes.trim() || null,
      };

      const result = row.isDraft
        ? await supabase.from('expense_entries').insert(payload).select('id').single()
        : await supabase.from('expense_entries').update(payload).eq('id', row.persistedId);

      if (result.error) {
        setRows((currentRows) => {
          const nextRows: ExpenseGridRow[] = currentRows.map((candidate) =>
            candidate.id === rowId ? { ...candidate, status: 'error', errorMessage: result.error.message } : candidate,
          );
          rowsRef.current = nextRows;
          return nextRows;
        });
        setFeedback(`No fue posible guardar el egreso: ${result.error.message}`);
        return;
      }

      const persistedId = row.isDraft ? result.data?.id ?? null : row.persistedId;

      if (!persistedId) {
        updateExpenseRow(rowId, {
          status: 'error',
          errorMessage: 'No se recibió el identificador del egreso guardado.',
        });
        setFeedback('No se recibió el identificador del egreso guardado.');
        return;
      }

      const savedRow: ExpenseGridRow = {
        ...normalizeExpenseGridRow(row),
        persistedId,
        isDraft: false,
        status: 'saved',
        errorMessage: null,
        ticketUrl: row.ticketUrl.trim(),
        ticketId: row.ticketUrl.trim() || null,
      };

      if (isDateWithinRange(savedRow.entryDate, activeDateRange)) {
        persistedRowsRef.current.set(rowId, savedRow);
      } else {
        persistedRowsRef.current.delete(rowId);
      }

      const wasDraft = row.isDraft;

      setRows((currentRows) => {
        let nextRows: ExpenseGridRow[];

        if (!isDateWithinRange(savedRow.entryDate, activeDateRange)) {
          nextRows = withExpenseDraftRow(currentRows.filter((candidate) => candidate.id !== rowId));
        } else {
          nextRows = withExpenseDraftRow(currentRows.map((candidate) => (candidate.id === rowId ? savedRow : candidate)));
        }

        rowsRef.current = nextRows;
        setActiveExpenseId(wasDraft ? (nextRows.find((candidate) => candidate.isDraft)?.id ?? savedRow.id) : savedRow.id);
        return nextRows;
      });

      setFeedback(row.isDraft ? 'Egreso guardado correctamente.' : 'Egreso actualizado correctamente.');
    },
    [activeDateRange, unitsOfMeasure],
  );

  const handleDeleteRow = useCallback(
    async (row: ExpenseGridRow) => {
      if (row.isDraft) {
        setRows((currentRows) => {
          const nextRows = withExpenseDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
          rowsRef.current = nextRows;
          setActiveExpenseId(nextRows.find((candidate) => candidate.isDraft)?.id ?? nextRows[0]?.id ?? null);
          return nextRows;
        });
        setFeedback('Fila de captura reiniciada.');
        return;
      }

      if (!supabase) {
        setFeedback('Supabase no está disponible para eliminar egresos.');
        return;
      }

      if (!window.confirm('Eliminar este egreso?')) {
        return;
      }

      const { error } = await supabase.from('expense_entries').delete().eq('id', row.persistedId);

      if (error) {
        setFeedback(`No fue posible eliminar el egreso: ${error.message}`);
        return;
      }

      persistedRowsRef.current.delete(row.id);
      setRows((currentRows) => {
        const nextRows = withExpenseDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
        rowsRef.current = nextRows;
        setActiveExpenseId(nextRows.find((candidate) => candidate.isDraft)?.id ?? nextRows[0]?.id ?? null);
        return nextRows;
      });
      setFeedback('Egreso eliminado correctamente.');
    },
    [],
  );

  const handleRevertRow = useCallback((row: ExpenseGridRow) => {
    if (row.isDraft) {
      setRows((currentRows) => {
        const nextRows = withExpenseDraftRow(currentRows.filter((candidate) => candidate.id !== row.id));
        rowsRef.current = nextRows;
        setActiveExpenseId(nextRows.find((candidate) => candidate.isDraft)?.id ?? nextRows[0]?.id ?? null);
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
      const nextRows = withExpenseDraftRow(currentRows.map((candidate) => (candidate.id === row.id ? persistedRow : candidate)));
      rowsRef.current = nextRows;
      setActiveExpenseId(persistedRow.id);
      return nextRows;
    });
    setFeedback('Se restauraron los últimos valores guardados de la fila.');
  }, []);

  const handleDuplicateRow = useCallback((row: ExpenseGridRow) => {
    const duplicatedRow = normalizeExpenseGridRow({
      ...row,
      id: createLocalId('expense-draft'),
      persistedId: null,
      isDraft: true,
      status: 'new',
      errorMessage: null,
      ticketId: null,
    });

    setRows((currentRows) => {
      const nextRows = [duplicatedRow, ...currentRows.filter((candidate) => !candidate.isDraft)];
      rowsRef.current = nextRows;
      setActiveExpenseId(duplicatedRow.id);
      return nextRows;
    });
    setFeedback('Se duplicó el egreso en una nueva fila de captura.');
  }, []);

  const categoryOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Selecciona una categoría' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
    [categories],
  );
  const paymentInstrumentOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Sin instrumento' }, ...paymentInstruments.map((instrument) => ({ value: instrument.id, label: instrument.name }))],
    [paymentInstruments],
  );
  const storeOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Sin tienda' }, ...stores.map((store) => ({ value: store.id, label: store.name }))],
    [stores],
  );
  const unitOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Sin unidad' }, ...unitsOfMeasure.map((unit) => ({ value: unit.id, label: unit.name }))],
    [unitsOfMeasure],
  );
  const currencyOptions = useMemo<readonly SelectOption[]>(
    () => [
      { value: 'MXN', label: 'MXN' },
      { value: 'USD', label: 'USD' },
    ],
    [],
  );
  const categoryFilterOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Todas' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
    [categories],
  );
  const paymentInstrumentFilterOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Todos' }, ...paymentInstruments.map((instrument) => ({ value: instrument.id, label: instrument.name }))],
    [paymentInstruments],
  );
  const storeFilterOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Todas' }, ...stores.map((store) => ({ value: store.id, label: store.name }))],
    [stores],
  );

  const categoryLabelById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const paymentInstrumentLabelById = useMemo(
    () => new Map(paymentInstruments.map((instrument) => [instrument.id, instrument.name])),
    [paymentInstruments],
  );
  const storeLabelById = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const unitLabelById = useMemo(() => new Map(unitsOfMeasure.map((unit) => [unit.id, unit.name])), [unitsOfMeasure]);
  const visibleRows = useMemo(() => {
    const entryDateFilter = tableFilters.entryDate.trim();
    const conceptFilter = tableFilters.concept.trim().toLocaleLowerCase();
    const categoryIdFilter = tableFilters.categoryId.trim();
    const paymentInstrumentIdFilter = tableFilters.paymentInstrumentId.trim();
    const storeIdFilter = tableFilters.storeId.trim();
    const filteredRows = rows.filter((row) => {
      if (row.isDraft) {
        return false;
      }

      if (entryDateFilter && row.entryDate !== entryDateFilter) {
        return false;
      }

      if (conceptFilter && !row.concept.toLocaleLowerCase().includes(conceptFilter)) {
        return false;
      }

      if (categoryIdFilter && row.categoryId !== categoryIdFilter) {
        return false;
      }

      if (paymentInstrumentIdFilter && row.paymentInstrumentId !== paymentInstrumentIdFilter) {
        return false;
      }

      if (storeIdFilter && row.storeId !== storeIdFilter) {
        return false;
      }

      return true;
    });

    return filteredRows;
  }, [rows, tableFilters]);
  const visibleExpenseSummary = useMemo(() => {
    const persistedVisibleRows = visibleRows.filter((row) => !row.isDraft);
    const totalAmount = persistedVisibleRows.reduce((sum, row) => {
      const rowTotal = Number(row.totalAmountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);

    return {
      count: persistedVisibleRows.length,
      totalLabel: formatCurrencyTotal(totalAmount),
    };
  }, [visibleRows]);
  const hasActiveTableFilters = Boolean(
    tableFilters.entryDate ||
      tableFilters.concept ||
      tableFilters.categoryId ||
      tableFilters.paymentInstrumentId ||
      tableFilters.storeId,
  );
  const activeExpenseRow = useMemo(
    () => rows.find((row) => row.id === activeExpenseId) ?? rows.find((row) => row.isDraft) ?? null,
    [activeExpenseId, rows],
  );
  const activeExpenseTitle = activeExpenseRow?.isDraft ? 'Nuevo egreso' : 'Editar egreso';
  const currentDraftRow = useMemo(() => rows.find((row) => row.isDraft) ?? null, [rows]);

  function resetTableFilters() {
    setTableFilters({
      entryDate: '',
      concept: '',
      categoryId: '',
      paymentInstrumentId: '',
      storeId: '',
    });
  }

  function renderTextFilterHeaderCell(
    props: RenderHeaderCellProps<ExpenseGridRow>,
    config: {
      label: string;
      value: string;
      ariaLabel: string;
      placeholder?: string;
      onChange: (value: string) => void;
    },
  ) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">{config.label}</div>
        <input
          type="text"
          className="grid-header-filter__input"
          value={config.value}
          placeholder={config.placeholder ?? 'Filtrar'}
          tabIndex={props.tabIndex}
          aria-label={config.ariaLabel}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.stopPropagation();
            }
          }}
          onChange={(event) => {
            config.onChange(event.target.value);
          }}
        />
      </div>
    );
  }

  function renderDateHeaderCell(props: RenderHeaderCellProps<ExpenseGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Fecha</div>
        <AppDatePicker
          className="grid-header-filter__input"
          value={tableFilters.entryDate}
          ariaLabel="Filtrar egresos por fecha"
          placeholder="AAAA-MM-DD"
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.stopPropagation();
            }
          }}
          onChange={(value) => {
            setTableFilters((currentFilters) => ({
              ...currentFilters,
              entryDate: value,
            }));
          }}
        />
      </div>
    );
  }

  function renderConceptHeaderCell(props: RenderHeaderCellProps<ExpenseGridRow>) {
    return renderTextFilterHeaderCell(props, {
      label: 'Concepto',
      value: tableFilters.concept,
      ariaLabel: 'Filtrar egresos por concepto',
      onChange: (value) => {
        setTableFilters((currentFilters) => ({
          ...currentFilters,
          concept: value,
        }));
      },
    });
  }

  function renderCategoryHeaderCell(props: RenderHeaderCellProps<ExpenseGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Categoría</div>
        <AppSelect
          compact
          ariaLabel="Filtrar egresos por categoría"
          options={categoryFilterOptions}
          value={tableFilters.categoryId}
          placeholder="Todas"
          onChange={(value) => {
            setTableFilters((currentFilters) => ({
              ...currentFilters,
              categoryId: value,
            }));
          }}
        />
      </div>
    );
  }

  function renderPaymentInstrumentHeaderCell(props: RenderHeaderCellProps<ExpenseGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Pago con</div>
        <AppSelect
          compact
          ariaLabel="Filtrar egresos por instrumento de pago"
          options={paymentInstrumentFilterOptions}
          value={tableFilters.paymentInstrumentId}
          placeholder="Todos"
          onChange={(value) => {
            setTableFilters((currentFilters) => ({
              ...currentFilters,
              paymentInstrumentId: value,
            }));
          }}
        />
      </div>
    );
  }

  function renderStoreHeaderCell(props: RenderHeaderCellProps<ExpenseGridRow>) {
    return (
      <div className="grid-header-filter" onClick={(event) => event.stopPropagation()}>
        <div className="grid-header-filter__label">Tienda</div>
        <AppSelect
          compact
          ariaLabel="Filtrar egresos por tienda"
          options={storeFilterOptions}
          value={tableFilters.storeId}
          placeholder="Todas"
          onChange={(value) => {
            setTableFilters((currentFilters) => ({
              ...currentFilters,
              storeId: value,
            }));
          }}
        />
      </div>
    );
  }

  const columns = useMemo<readonly Column<ExpenseGridRow>[]>(
    () => [
      {
        key: 'entryDate',
        name: 'Fecha',
        width: DATE_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderDateHeaderCell,
      },
      {
        key: 'concept',
        name: 'Concepto',
        width: CONCEPT_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderConceptHeaderCell,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: QUANTITY_COLUMN_WIDTH,
      },
      {
        key: 'unitOfMeasureId',
        name: 'U de medida',
        width: UNIT_COLUMN_WIDTH,
        renderCell: ({ row }) => unitLabelById.get(row.unitOfMeasureId) ?? '-',
      },
      {
        key: 'subtotalOriginal',
        name: 'Subtotal',
        width: SUBTOTAL_COLUMN_WIDTH,
      },
      {
        key: 'categoryId',
        name: 'Categoría',
        width: CATEGORY_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderCategoryHeaderCell,
        renderCell: ({ row }) => categoryLabelById.get(row.categoryId) ?? '-',
      },
      {
        key: 'paymentInstrumentId',
        name: 'Pago con',
        width: PAYMENT_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderPaymentInstrumentHeaderCell,
        renderCell: ({ row }) => paymentInstrumentLabelById.get(row.paymentInstrumentId) ?? '-',
      },
      {
        key: 'storeId',
        name: 'Tienda',
        width: STORE_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderStoreHeaderCell,
        renderCell: ({ row }) => storeLabelById.get(row.storeId) ?? '-',
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: CURRENCY_COLUMN_WIDTH,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX a MXN',
        width: FX_COLUMN_WIDTH,
        renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
      },
      {
        key: 'totalAmountMxn',
        name: 'Total MXN',
        width: TOTAL_COLUMN_WIDTH,
        editable: false,
      },
      {
        key: 'notes',
        name: 'Notas',
        width: NOTES_COLUMN_WIDTH,
      },
    ],
    [
      categoryLabelById,
      paymentInstrumentLabelById,
      renderCategoryHeaderCell,
      renderConceptHeaderCell,
      renderDateHeaderCell,
      renderPaymentInstrumentHeaderCell,
      renderStoreHeaderCell,
      storeLabelById,
      unitLabelById,
    ],
  );

  const currentErrorMessage = rows.find((row) => row.status === 'error')?.errorMessage;
  const calculatorResult = useMemo(() => {
    const evaluation = evaluateArithmeticExpression(calculatorExpression);

    if (evaluation.value == null) {
      return {
        displayValue: '',
        numericValue: null as number | null,
        error: evaluation.error,
      };
    }

    return {
      displayValue: Number(evaluation.value.toFixed(6)).toString(),
      numericValue: evaluation.value,
      error: null as string | null,
    };
  }, [calculatorExpression]);
  const showCapturePanel = !isNarrowViewport || mobilePrimaryPanel === 'capture';
  const showHistoryPanel = !isNarrowViewport || mobilePrimaryPanel === 'history';

  return (
    <div className="page">
      <section className="card finance-panel">
        <div className="income-toolbar">
          <div className="income-toolbar__controls">
            <PeriodFilter ariaLabel="Filtrar egresos por fecha" value={dateFilter} onChange={setDateFilter} disabled={isLoading} />
            <button
              type="button"
              className={`grid-action income-toolbar__action ${hasActiveTableFilters ? 'grid-action--delete' : 'grid-action--clear'}`}
              aria-label="Resetear filtros"
              title="Resetear filtros"
              disabled={!hasActiveTableFilters}
              onClick={resetTableFilters}
            >
              <FontAwesomeIcon icon={faFilterCircleXmark} />
            </button>
          </div>

          <div className="badge-row" aria-label="Resumen de egresos visibles">
            <span className="badge">{visibleExpenseSummary.count} regs</span>
            <span className="badge">{visibleExpenseSummary.totalLabel}</span>
          </div>

        </div>


        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        {currentErrorMessage ? <div className="feedback-banner feedback-banner--error">{currentErrorMessage}</div> : null}

        {isNarrowViewport ? (
          <div className="expense-workspace-toggle" role="tablist" aria-label="Cambiar vista de egresos">
            <button
              type="button"
              role="tab"
              aria-selected={mobilePrimaryPanel === 'capture'}
              className={`expense-workspace-toggle__button${mobilePrimaryPanel === 'capture' ? ' expense-workspace-toggle__button--active' : ''}`}
              onClick={() => setMobilePrimaryPanel('capture')}
            >
              Captura
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePrimaryPanel === 'history'}
              className={`expense-workspace-toggle__button${mobilePrimaryPanel === 'history' ? ' expense-workspace-toggle__button--active' : ''}`}
              onClick={() => setMobilePrimaryPanel('history')}
            >
              Historial
            </button>
          </div>
        ) : null}

        {showCapturePanel && activeExpenseRow ? (
          <section className="expense-entry-editor" aria-label="Editor de egreso activo">
            <div className="expense-entry-editor__header">
              <div className="expense-entry-editor__title">
                <strong>{activeExpenseTitle}</strong>
              </div>
            </div>

            <div className="finance-form expense-entry-editor__form">
              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--date">
                <span>Fecha</span>
                <AppDatePicker
                  value={activeExpenseRow.entryDate}
                  ariaLabel="Fecha del egreso"
                  disabled={!canEditExpenseColumn(activeExpenseRow, 'entryDate')}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { entryDate: value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--concept">
                <span>Concepto</span>
                <input
                  type="text"
                  value={activeExpenseRow.concept}
                  placeholder="Supermercado, renta, gasolina"
                  onChange={(event) => {
                    updateExpenseRow(activeExpenseRow.id, { concept: event.target.value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--quantity">
                <span>Cantidad</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={activeExpenseRow.quantity}
                  onChange={(event) => {
                    updateExpenseRow(activeExpenseRow.id, { quantity: event.target.value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--unit">
                <span>Unidad</span>
                <AppSelect
                  ariaLabel="Unidad de medida del egreso"
                  options={unitOptions}
                  value={activeExpenseRow.unitOfMeasureId}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { unitOfMeasureId: value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--subtotal">
                <span>Subtotal</span>
                <div className="expense-entry-editor__subtotal-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={activeExpenseRow.subtotalOriginal}
                    onChange={(event) => {
                      updateExpenseRow(activeExpenseRow.id, { subtotalOriginal: event.target.value });
                    }}
                  />
                  <button
                    type="button"
                    className={`expense-entry-editor__calculator-toggle${isSubtotalCalculatorOpen ? ' expense-entry-editor__calculator-toggle--active' : ''}`}
                    aria-label="Abrir calculadora de subtotal"
                    title="Calculadora"
                    onClick={() => {
                      setIsSubtotalCalculatorOpen((currentValue) => !currentValue);
                    }}
                  >
                    <FontAwesomeIcon icon={faCalculator} />
                  </button>
                </div>
                {isSubtotalCalculatorOpen ? (
                  <div className="expense-entry-editor__calculator" aria-label="Calculadora de subtotal">
                    <input
                      type="text"
                      className="expense-entry-editor__calculator-input"
                      value={calculatorExpression}
                      onChange={(event) => {
                        setCalculatorExpression(event.target.value);
                      }}
                      placeholder="2+3*10"
                      aria-label="Expresión aritmética"
                      spellCheck={false}
                    />
                    <span className={`expense-entry-editor__calculator-result${calculatorResult.error ? ' expense-entry-editor__calculator-result--error' : ''}`}>
                      {calculatorResult.error ? calculatorResult.error : calculatorResult.displayValue || '='}
                    </span>
                    <button
                      type="button"
                      className="expense-entry-editor__calculator-apply"
                      disabled={calculatorResult.numericValue == null}
                      onClick={() => {
                        if (calculatorResult.numericValue == null) {
                          return;
                        }

                        updateExpenseRow(activeExpenseRow.id, { subtotalOriginal: calculatorResult.displayValue });
                        setIsSubtotalCalculatorOpen(false);
                      }}
                    >
                      Usar
                    </button>
                  </div>
                ) : null}
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--category">
                <span>Categoría</span>
                <AppSelect
                  ariaLabel="Categoría del egreso"
                  options={categoryOptions}
                  value={activeExpenseRow.categoryId}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { categoryId: value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--payment">
                <span>Pago con</span>
                <AppSelect
                  ariaLabel="Instrumento de pago del egreso"
                  options={paymentInstrumentOptions}
                  value={activeExpenseRow.paymentInstrumentId}
                  isDisabled={!canEditExpenseColumn(activeExpenseRow, 'paymentInstrumentId')}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { paymentInstrumentId: value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--store">
                <span>Tienda</span>
                <AppSelect
                  ariaLabel="Tienda del egreso"
                  options={storeOptions}
                  value={activeExpenseRow.storeId}
                  isDisabled={!canEditExpenseColumn(activeExpenseRow, 'storeId')}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { storeId: value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--currency">
                <span>Moneda</span>
                <AppSelect
                  ariaLabel="Moneda del egreso"
                  options={currencyOptions}
                  value={activeExpenseRow.currencyCode}
                  onChange={(value) => {
                    updateExpenseRow(activeExpenseRow.id, { currencyCode: value as 'MXN' | 'USD' });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--fx">
                <span>FX</span>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={activeExpenseRow.currencyCode === 'MXN' ? '1' : activeExpenseRow.fxRateToMxn}
                  disabled={activeExpenseRow.currencyCode === 'MXN'}
                  onChange={(event) => {
                    updateExpenseRow(activeExpenseRow.id, { fxRateToMxn: event.target.value });
                  }}
                />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--total">
                <span>Total MXN</span>
                <input type="text" value={activeExpenseRow.totalAmountMxn} disabled readOnly />
              </label>

              <label className="catalog-field expense-entry-editor__field expense-entry-editor__field--notes">
                <span>Notas</span>
                <input
                  type="text"
                  value={activeExpenseRow.notes}
                  placeholder="Opcional"
                  onChange={(event) => {
                    updateExpenseRow(activeExpenseRow.id, { notes: event.target.value });
                  }}
                />
              </label>
            </div>

            <div className="expense-entry-editor__footer">
              <div className="expense-entry-editor__actions">
                <button
                  type="button"
                  className="expense-entry-editor__action expense-entry-editor__action--save"
                  aria-label="Guardar egreso"
                  title="Guardar"
                  onClick={() => {
                    void persistExpenseRow(activeExpenseRow.id);
                  }}
                >
                  <FontAwesomeIcon icon={faFloppyDisk} />
                </button>
                {activeExpenseRow.isDraft ? (
                  <button
                    type="button"
                    className="expense-entry-editor__action expense-entry-editor__action--clear"
                    aria-label="Limpiar captura"
                    title="Limpiar"
                    onClick={() => {
                      handleRevertRow(activeExpenseRow);
                    }}
                  >
                    <FontAwesomeIcon icon={faEraser} />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="expense-entry-editor__action expense-entry-editor__action--duplicate"
                      aria-label="Duplicar egreso"
                      title="Duplicar"
                      onClick={() => {
                        handleDuplicateRow(activeExpenseRow);
                      }}
                    >
                      <FontAwesomeIcon icon={faCopy} />
                    </button>
                    <button
                      type="button"
                      className="expense-entry-editor__action expense-entry-editor__action--revert"
                      aria-label="Deshacer cambios"
                      title="Deshacer"
                      onClick={() => {
                        handleRevertRow(activeExpenseRow);
                      }}
                    >
                      <FontAwesomeIcon icon={faRotateLeft} />
                    </button>
                    {activeExpenseRow.ticketId ? (
                      <Link
                        className="expense-entry-editor__action"
                        to={`/spending/scan?ticket=${activeExpenseRow.ticketId}`}
                        aria-label="Ver ticket"
                        title="Ver ticket"
                      >
                        <FontAwesomeIcon icon={faReceipt} />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="expense-entry-editor__action expense-entry-editor__action--delete"
                      aria-label="Eliminar egreso"
                      title="Eliminar"
                      onClick={() => {
                        void handleDeleteRow(activeExpenseRow);
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </>
                )}
                {currentDraftRow && currentDraftRow.id !== activeExpenseRow.id ? (
                  <button
                    type="button"
                    className="expense-entry-editor__action expense-entry-editor__action--clear"
                    aria-label="Ir a nueva captura"
                    title="Nueva captura"
                    onClick={() => {
                      setActiveExpenseId(currentDraftRow.id);
                    }}
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {showHistoryPanel ? (
          <div className="grid-wrapper grid-wrapper--tall">
          <DataGrid
            ref={gridRef}
            columns={columns}
            rows={visibleRows}
            rowHeight={GRID_ROW_HEIGHT}
            headerRowHeight={FILTER_HEADER_ROW_HEIGHT}
            rowKeyGetter={(row) => row.id}
            onCellClick={(args) => {
              if (args.row) {
                setActiveExpenseId(args.row.id);
                if (isNarrowViewport) {
                  setMobilePrimaryPanel('capture');
                }
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
              if (row.id === activeExpenseRow?.id) classNames.push('row-selected-soft');
              return classNames.join(' ');
            }}
            style={{ blockSize: 500 }}
          />
          </div>
        ) : null}

      </section>
    </div>
  );
}
