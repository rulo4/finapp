import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faEraser, faFilterCircleXmark, faFloppyDisk, faReceipt, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle, type RenderHeaderCellProps } from 'react-data-grid';
import { Link } from 'react-router-dom';
import { AppDatePicker } from '../features/shared/AppDatePicker';
import { AppSelect, InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import {
  getStartOfCurrentMonthIsoDate,
  getStartOfCurrentYearIsoDate,
  getTodayIsoDate,
  isIsoDateString,
} from '../features/shared/isoDate';
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

type ExpenseDateFilterMode = 'all' | 'month' | 'year';

type ExpenseTableFilters = {
  entryDate: string;
  concept: string;
  categoryId: string;
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

function getStartOfCurrentMonth() {
  return getStartOfCurrentMonthIsoDate();
}

function getStartOfCurrentYear() {
  return getStartOfCurrentYearIsoDate();
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

const ACTION_COLUMN_WIDTH = 72;
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

function normalizeExpenseGridRow(row: ExpenseGridRow): ExpenseGridRow {
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
  const parsedSubtotal = Number(row.subtotalOriginal);
  const parsedFxRate = Number(fxRateToMxn);

  return {
    ...row,
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
      throw new Error('Expresion invalida');
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
      return { value: null, error: 'Expresion invalida' };
    }

    return { value, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Expresion invalida',
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
  const [dateFilterMode, setDateFilterMode] = useState<ExpenseDateFilterMode>('month');
  const [tableFilters, setTableFilters] = useState<ExpenseTableFilters>({
    entryDate: '',
    concept: '',
    categoryId: '',
  });
  const [calculatorExpression, setCalculatorExpression] = useState('');
  const [calculatorCopyState, setCalculatorCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const rowsRef = useRef<ExpenseGridRow[]>([]);
  const persistedRowsRef = useRef<Map<string, ExpenseGridRow>>(new Map());
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

  const loadExpenseData = useCallback(async () => {
    if (!activeDateRange) {
      return;
    }

    if (!supabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no esta configurado para este entorno.');
      return;
    }

    setIsLoading(true);

    let entriesQuery = supabase
      .from('expense_entries')
      .select(
        'id, entry_date, concept, quantity, unit_of_measure_id, unit_of_measure, subtotal_original, total_amount_mxn, currency_code, fx_rate_to_mxn, category_id, payment_instrument_id, store_id, ticket_url, notes, expense_categories(name), payment_instruments(name), stores(name)',
      )
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (activeDateRange.start) {
      entriesQuery = entriesQuery.gte('entry_date', activeDateRange.start);
    }

    if (activeDateRange.end) {
      entriesQuery = entriesQuery.lte('entry_date', activeDateRange.end);
    }

    const [categoriesResult, instrumentsResult, storesResult, unitsResult, entriesResult] = await Promise.all([
      supabase.from('expense_categories').select('id, name').order('name', { ascending: true }),
      supabase.from('payment_instruments').select('id, name').order('name', { ascending: true }),
      supabase.from('stores').select('id, name').order('name', { ascending: true }),
      supabase.from('unit_of_measures').select('id, name').order('name', { ascending: true }),
      entriesQuery,
    ]);

    if (categoriesResult.error) {
      setFeedback(`No fue posible cargar categorias: ${categoriesResult.error.message}`);
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
    setFeedback(null);
    setIsLoading(false);
  }, [activeDateRange]);

  useEffect(() => {
    if (!activeDateRange) {
      return;
    }

    void loadExpenseData();
  }, [activeDateRange, loadExpenseData]);

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

  function commitExpenseRows(nextRows: ExpenseGridRow[], rowIndex: number | null) {
    if (rowIndex == null) {
      rowsRef.current = nextRows;
      setRows(nextRows);
      return;
    }

    const normalizedRow = normalizeExpenseGridRow(nextRows[rowIndex]);
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
        setFeedback('Supabase no esta disponible para guardar egresos.');
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

      setRows((currentRows) => {
        let nextRows: ExpenseGridRow[];
        const currentRowIndex = currentRows.findIndex((candidate) => candidate.id === rowId);

        if (!isDateWithinRange(savedRow.entryDate, activeDateRange)) {
          nextRows = withExpenseDraftRow(currentRows.filter((candidate) => candidate.id !== rowId));
        } else {
          nextRows = withExpenseDraftRow(currentRows.map((candidate) => (candidate.id === rowId ? savedRow : candidate)));
        }

        rowsRef.current = nextRows;
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
          return nextRows;
        });
        setFeedback('Fila de captura reiniciada.');
        return;
      }

      if (!supabase) {
        setFeedback('Supabase no esta disponible para eliminar egresos.');
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
      return nextRows;
    });
    setFeedback('Se restauraron los ultimos valores guardados de la fila.');
  }, []);

  const categoryOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Selecciona una categoria' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
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

  const categoryLabelById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const paymentInstrumentLabelById = useMemo(
    () => new Map(paymentInstruments.map((instrument) => [instrument.id, instrument.name])),
    [paymentInstruments],
  );
  const storeLabelById = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const unitLabelById = useMemo(() => new Map(unitsOfMeasure.map((unit) => [unit.id, unit.name])), [unitsOfMeasure]);
  const visibleRows = useMemo(() => {
    const draftRow = rows.find((row) => row.isDraft) ?? null;
    const entryDateFilter = tableFilters.entryDate.trim();
    const conceptFilter = tableFilters.concept.trim().toLocaleLowerCase();
    const categoryIdFilter = tableFilters.categoryId.trim();
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

      return true;
    });

    return draftRow ? [draftRow, ...filteredRows] : filteredRows;
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
  const hasActiveTableFilters = Boolean(tableFilters.entryDate || tableFilters.concept || tableFilters.categoryId);

  function resetTableFilters() {
    setTableFilters({
      entryDate: '',
      concept: '',
      categoryId: '',
    });
  }

  function renderActionsHeaderCell() {
    return (
      <div className="grid-header-action" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`grid-action ${hasActiveTableFilters ? 'grid-action--delete' : 'grid-action--clear'}`}
          aria-label="Resetear filtros"
          title="Resetear filtros"
          disabled={!hasActiveTableFilters}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            resetTableFilters();
          }}
        >
          <FontAwesomeIcon icon={faFilterCircleXmark} className="grid-header-action__icon" />
        </button>
      </div>
    );
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
        <div className="grid-header-filter__label">Categoria</div>
        <AppSelect
          compact
          ariaLabel="Filtrar egresos por categoria"
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

  const columns = useMemo<readonly Column<ExpenseGridRow>[]>(
    () => [
      {
        key: 'actions',
        name: '',
        width: ACTION_COLUMN_WIDTH,
        frozen: true,
        editable: false,
        headerCellClass: 'grid-header-action-cell',
        renderHeaderCell: renderActionsHeaderCell,
        renderCell: ({ row }) => {
          const showPrimaryActions = row.isDraft || row.status === 'dirty' || row.status === 'error';
          const actionCount = showPrimaryActions ? 2 : row.ticketId ? 2 : 1;

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
                        void persistExpenseRow(row.id);
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
                <>
                  {row.ticketId ? (
                    <Link
                      className="grid-action grid-action--ticket"
                      to={`/tickets/scan?ticket=${row.ticketId}`}
                      title="Ver ticket"
                      aria-label="Ver ticket"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <FontAwesomeIcon icon={faReceipt} />
                    </Link>
                  ) : null}
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
                </>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'entryDate',
        name: 'Fecha',
        width: DATE_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderDateHeaderCell,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
      },
      {
        key: 'concept',
        name: 'Concepto',
        width: CONCEPT_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderConceptHeaderCell,
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Supermercado, renta, gasolina" />,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: QUANTITY_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="Cantidad" />,
      },
      {
        key: 'unitOfMeasureId',
        name: 'U de medida',
        width: UNIT_COLUMN_WIDTH,
        renderCell: ({ row }) => unitLabelById.get(row.unitOfMeasureId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={unitOptions} />,
      },
      {
        key: 'subtotalOriginal',
        name: 'Subtotal',
        width: SUBTOTAL_COLUMN_WIDTH,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" placeholder="0.00" />,
      },
      {
        key: 'categoryId',
        name: 'Categoria',
        width: CATEGORY_COLUMN_WIDTH,
        headerCellClass: 'grid-header-filter-cell',
        renderHeaderCell: renderCategoryHeaderCell,
        renderCell: ({ row }) => categoryLabelById.get(row.categoryId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={categoryOptions} />,
      },
      {
        key: 'paymentInstrumentId',
        name: 'Pago con',
        width: PAYMENT_COLUMN_WIDTH,
        renderCell: ({ row }) => paymentInstrumentLabelById.get(row.paymentInstrumentId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={paymentInstrumentOptions} />,
      },
      {
        key: 'storeId',
        name: 'Tienda',
        width: STORE_COLUMN_WIDTH,
        renderCell: ({ row }) => storeLabelById.get(row.storeId) ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={storeOptions} />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: CURRENCY_COLUMN_WIDTH,
        renderEditCell: (props) => <SelectCellEditor {...props} options={currencyOptions} />,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX a MXN',
        width: FX_COLUMN_WIDTH,
        renderCell: ({ row }) => (row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn || '-'),
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" placeholder="1.000000" />,
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
        renderEditCell: (props) => <InputCellEditor {...props} placeholder="Observaciones opcionales" />,
      },
    ],
    [
      categoryLabelById,
      categoryOptions,
      currencyOptions,
      handleDeleteRow,
      handleRevertRow,
      hasActiveTableFilters,
      paymentInstrumentLabelById,
      paymentInstrumentOptions,
      persistExpenseRow,
      renderCategoryHeaderCell,
      categoryFilterOptions,
      renderActionsHeaderCell,
      renderConceptHeaderCell,
      renderDateHeaderCell,
      storeLabelById,
      storeOptions,
      tableFilters.categoryId,
      unitLabelById,
      unitOptions,
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

  const handleCopyCalculatorResult = useCallback(async () => {
    if (calculatorResult.numericValue == null) {
      setCalculatorCopyState('error');
      return;
    }

    try {
      await navigator.clipboard.writeText(calculatorResult.displayValue);
      setCalculatorCopyState('copied');
      window.setTimeout(() => {
        setCalculatorCopyState('idle');
      }, 1200);
    } catch {
      setCalculatorCopyState('error');
    }
  }, [calculatorResult.displayValue, calculatorResult.numericValue]);

  function handleSelectDateFilter(nextMode: ExpenseDateFilterMode) {
    setDateFilterMode(nextMode);
  }

  function handleRowsChange(nextRows: ExpenseGridRow[], data: { indexes: number[] }) {
    const nextVisibleRowsById = new Map(nextRows.map((row) => [row.id, row]));
    const mergedRows = rowsRef.current.map((row) => nextVisibleRowsById.get(row.id) ?? row);
    const updatedVisibleRow = data.indexes[0] == null ? null : nextRows[data.indexes[0]];
    const updatedRowIndex = updatedVisibleRow
      ? mergedRows.findIndex((row) => row.id === updatedVisibleRow.id)
      : null;

    commitExpenseRows(mergedRows, updatedRowIndex != null && updatedRowIndex >= 0 ? updatedRowIndex : null);
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
            <div className="income-period-filter" role="group" aria-label="Filtrar egresos por fecha">
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

          <div className="badge-row" aria-label="Resumen de egresos visibles">
            <span className="badge">{visibleExpenseSummary.count} regs</span>
            <span className="badge">{visibleExpenseSummary.totalLabel}</span>
          </div>

        </div>


        {feedback ? <div className={isErrorFeedback(feedback) ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        {currentErrorMessage ? <div className="feedback-banner feedback-banner--error">{currentErrorMessage}</div> : null}

        <div className="grid-wrapper grid-wrapper--tall">
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
        </div>

        <div className="expense-helper-panel" aria-label="Calculadora rápida de subtotal">
          <div className="mini-calculator">
            <input
              type="text"
              className="mini-calculator__input"
              value={calculatorExpression}
              onChange={(event) => {
                setCalculatorExpression(event.target.value);
                setCalculatorCopyState('idle');
              }}
              placeholder="calculadora"
              aria-label="Expresion aritmetica"
              spellCheck={false}
            />
            <span className={`mini-calculator__result${calculatorResult.error ? ' mini-calculator__result--error' : ''}`}>
              {calculatorResult.error ? calculatorResult.error : calculatorResult.displayValue || '='}
            </span>
            <button
              type="button"
              className="mini-calculator__copy"
              aria-label="Copiar resultado"
              title={
                calculatorCopyState === 'copied'
                  ? 'Resultado copiado'
                  : calculatorCopyState === 'error'
                    ? 'No se pudo copiar el resultado'
                    : 'Copiar resultado'
              }
              onClick={() => {
                void handleCopyCalculatorResult();
              }}
              disabled={calculatorResult.numericValue == null}
            >
              <FontAwesomeIcon icon={faCopy} />
            </button>
          </div>
        </div>

      </section>
    </div>
  );
}
