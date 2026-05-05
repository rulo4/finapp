import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRotateRight, faArrowLeft, faCalendarDay, faCamera, faCloudArrowUp, faCreditCard, faFloppyDisk, faImage, faPlus, faReceipt, faShop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column, type DataGridHandle } from 'react-data-grid';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  AppSelect,
  FX_AUTO_SWITCH_FEEDBACK,
  InputCellEditor,
  SelectCellEditor,
  autoSwitchCurrencyFromFx,
  type SelectOption,
} from '../features/shared/gridEditors';
import { GridEditorNavigationProvider, moveToNextEditableGridCell } from '../features/shared/gridNavigation';
import { AppDatePicker } from '../features/shared/AppDatePicker';
import { getTodayIsoDate, isIsoDateString } from '../features/shared/isoDate';
import type { ParsedTicketExpense, TicketRecord, TicketStatus } from '../features/tickets/types';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type ExpenseCategory = { id: string; name: string };
type PaymentInstrument = { id: string; name: string };
type Store = { id: string; name: string };
type UnitOfMeasure = { id: string; name: string };

type ReviewRow = {
  id: string;
  selected: boolean;
  entryDate: string;
  concept: string;
  quantity: string;
  unitOfMeasureId: string;
  categoryId: string;
  paymentInstrumentId: string;
  storeId: string;
  currencyCode: 'MXN' | 'USD';
  subtotalOriginal: string;
  fxRateToMxn: string;
  totalAmountMxn: string;
  notes: string;
};

type TicketHeaderState = {
  entryDate: string;
  storeId: string;
  paymentInstrumentId: string;
};

const GRID_ROW_HEIGHT = 30;

function getTodayDate() {
  return getTodayIsoDate();
}

function createLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatEditableNumber(value: number | null | undefined) {
  if (value == null) {
    return '';
  }

  return String(Number(value));
}

function normalizeReviewRow(row: ReviewRow): ReviewRow {
  const nextRow = autoSwitchCurrencyFromFx(row);
  const fxRateToMxn = nextRow.currencyCode === 'MXN' ? '1' : nextRow.fxRateToMxn;
  const subtotalOriginal = Number(nextRow.subtotalOriginal);
  const fxRate = Number(fxRateToMxn);

  return {
    ...nextRow,
    fxRateToMxn,
    totalAmountMxn:
      Number.isFinite(subtotalOriginal) && Number.isFinite(fxRate) && fxRate > 0
        ? formatEditableNumber(Number((subtotalOriginal * fxRate).toFixed(6)))
        : '',
  };
}

function toReviewRow(expense: ParsedTicketExpense): ReviewRow {
  return normalizeReviewRow({
    id: createLocalId('ticket-row'),
    selected: true,
    entryDate: expense.entry_date,
    concept: expense.concept,
    quantity: formatEditableNumber(expense.quantity) || '1',
    unitOfMeasureId: expense.unit_of_measure_id ?? '',
    categoryId: expense.suggested_category_id ?? '',
    paymentInstrumentId: expense.suggested_payment_instrument_id ?? '',
    storeId: expense.suggested_store_id ?? '',
    currencyCode: expense.currency_code,
    subtotalOriginal: formatEditableNumber(expense.subtotal_original) || '0',
    fxRateToMxn: expense.currency_code === 'MXN' ? '1' : '',
    totalAmountMxn: '',
    notes: expense.notes ?? '',
  });
}

function getTicketHeaderFromRows(rows: ReviewRow[]): TicketHeaderState {
  const firstRow = rows[0];

  return {
    entryDate: firstRow?.entryDate ?? '',
    storeId: firstRow?.storeId ?? '',
    paymentInstrumentId: firstRow?.paymentInstrumentId ?? '',
  };
}

function applyTicketHeaderToRows(rows: ReviewRow[], header: TicketHeaderState): ReviewRow[] {
  return rows.map((row) =>
    normalizeReviewRow({
      ...row,
      entryDate: header.entryDate || row.entryDate,
      storeId: header.storeId,
      paymentInstrumentId: header.paymentInstrumentId,
    }),
  );
}

function createEmptyReviewRow(defaults?: Partial<Pick<ReviewRow, 'entryDate' | 'paymentInstrumentId' | 'storeId' | 'currencyCode'>>) {
  const currencyCode = defaults?.currencyCode ?? 'MXN';

  return normalizeReviewRow({
    id: createLocalId('ticket-row'),
    selected: true,
    entryDate: defaults?.entryDate ?? getTodayDate(),
    concept: '',
    quantity: '1',
    unitOfMeasureId: '',
    categoryId: '',
    paymentInstrumentId: defaults?.paymentInstrumentId ?? '',
    storeId: defaults?.storeId ?? '',
    currencyCode,
    subtotalOriginal: '0',
    fxRateToMxn: currencyCode === 'MXN' ? '1' : '',
    totalAmountMxn: '',
    notes: '',
  });
}

function loadImageFile(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No fue posible cargar la imagen seleccionada.'));
    };
    image.src = objectUrl;
  });
}

async function compressTicketImage(file: File) {
  const image = await loadImageFile(file);
  const maxWidth = 1200;
  const scale = image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('El navegador no pudo preparar el canvas para comprimir la imagen.');
  }

  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.75);
  });

  if (!blob) {
    throw new Error('No fue posible comprimir la imagen seleccionada.');
  }

  return blob;
}

function formatStatusLabel(status: TicketStatus) {
  switch (status) {
    case 'saved':
      return 'Guardado';
    case 'processed':
      return 'Listo';
    case 'error':
      return 'Error';
    case 'processing':
      return 'Procesando';
    default:
      return 'Pendiente';
  }
}

function formatPurchaseDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`));
}

function getStatusTone(status: TicketStatus) {
  switch (status) {
    case 'saved':
      return 'ok';
    case 'processed':
      return 'ok';
    case 'error':
      return 'error';
    default:
      return 'checking';
  }
}

function validateReviewRow(row: ReviewRow) {
  if (!row.entryDate || !isIsoDateString(row.entryDate)) {
    return 'usa una fecha válida en formato AAAA-MM-DD';
  }

  if (!row.concept.trim()) {
    return 'captura un concepto';
  }

  const quantity = Number(row.quantity);
  if (!row.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    return 'usa una cantidad mayor a cero';
  }

  const subtotal = Number(row.subtotalOriginal);
  if (!row.subtotalOriginal.trim() || !Number.isFinite(subtotal)) {
    return 'captura un subtotal numerico valido';
  }

  const fxRate = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return 'usa un tipo de cambio mayor a cero';
  }

  return null;
}

function isErrorFeedback(message: string) {
  const normalizedMessage = message.trim();

  return (
    /^(no\b|supabase\b|necesitas\b|primero\b|la fecha\b|la fila\b|el\b|la\b|selecciona\b|captura\b|este\b)/i.test(
      normalizedMessage,
    ) || /no se pudo/i.test(normalizedMessage)
  );
}

export function TicketScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [paymentInstruments, setPaymentInstruments] = useState<PaymentInstrument[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [unitsOfMeasure, setUnitsOfMeasure] = useState<UnitOfMeasure[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [currentTicketId, setCurrentTicketId] = useState<string | null>(null);
  const [currentTicketStatus, setCurrentTicketStatus] = useState<TicketStatus | null>(null);
  const [currentStoragePath, setCurrentStoragePath] = useState<string | null>(null);
  const [ticketEntryDate, setTicketEntryDate] = useState('');
  const [ticketStoreId, setTicketStoreId] = useState('');
  const [ticketPaymentInstrumentId, setTicketPaymentInstrumentId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isCatalogsLoading, setIsCatalogsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const gridRef = useRef<DataGridHandle>(null);
  const autoEditCellRef = useRef<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const ticketId = searchParams.get('ticket');

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!isImageViewerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsImageViewerOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isImageViewerOpen]);

  useEffect(() => {
    async function loadCatalogs() {
      if (!supabase || !isSupabaseConfigured()) {
        setFeedback('Supabase no está configurado en este entorno.');
        return;
      }

      setIsCatalogsLoading(true);
      const [categoriesResult, paymentInstrumentsResult, storesResult, unitsResult] = await Promise.all([
        supabase.from('expense_categories').select('id, name').eq('is_active', true).order('name'),
        supabase.from('payment_instruments').select('id, name').eq('is_active', true).order('name'),
        supabase.from('stores').select('id, name').eq('is_active', true).order('name'),
        supabase.from('unit_of_measures').select('id, name').eq('is_active', true).order('name'),
      ]);

      const firstError = categoriesResult.error || paymentInstrumentsResult.error || storesResult.error || unitsResult.error;

      if (firstError) {
        setFeedback(`No fue posible cargar los catálogos necesarios: ${firstError.message}`);
        setIsCatalogsLoading(false);
        return;
      }

      setCategories((categoriesResult.data as ExpenseCategory[]) ?? []);
      setPaymentInstruments((paymentInstrumentsResult.data as PaymentInstrument[]) ?? []);
      setStores((storesResult.data as Store[]) ?? []);
      setUnitsOfMeasure((unitsResult.data as UnitOfMeasure[]) ?? []);
      setIsCatalogsLoading(false);
    }

    void loadCatalogs();
  }, []);

  useEffect(() => {
    async function loadTicketFromHistory() {
      if (!ticketId || !supabase) {
        return;
      }

      setIsProcessing(true);
      setFeedback(null);

      const { data, error } = await supabase
        .from('tickets')
        .select('id, storage_path, status, entry_date, store_id, payment_instrument_id, raw_llm_response, parsed_expenses, error_message, created_at')
        .eq('id', ticketId)
        .single();

      if (error || !data) {
        setFeedback(`No fue posible cargar el ticket solicitado: ${error?.message ?? 'no encontrado'}`);
        setIsProcessing(false);
        return;
      }

      const ticket = data as TicketRecord;
      const initialRows = (ticket.parsed_expenses ?? []).map(toReviewRow);
      const fallbackHeader = getTicketHeaderFromRows(initialRows);
      const initialHeader = {
        entryDate: ticket.entry_date ?? fallbackHeader.entryDate,
        storeId: ticket.store_id ?? fallbackHeader.storeId,
        paymentInstrumentId: ticket.payment_instrument_id ?? fallbackHeader.paymentInstrumentId,
      };

      setCurrentTicketId(ticket.id);
      setCurrentTicketStatus(ticket.status);
      setCurrentStoragePath(ticket.storage_path);
      setTicketEntryDate(initialHeader.entryDate);
      setTicketStoreId(initialHeader.storeId);
      setTicketPaymentInstrumentId(initialHeader.paymentInstrumentId);
      setRows(applyTicketHeaderToRows(initialRows, initialHeader));
      setFeedback(ticket.error_message ?? null);

      const { data: signedUrlData } = await supabase.storage.from('tickets').createSignedUrl(ticket.storage_path, 3600);
      setPreviewUrl(signedUrlData?.signedUrl ?? null);
      setIsProcessing(false);
    }

    void loadTicketFromHistory();
  }, [ticketId]);

  const categoryOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Sin categoría' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
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
  const unitNameById = useMemo(() => new Map(unitsOfMeasure.map((unit) => [unit.id, unit.name])), [unitsOfMeasure]);
  const storeNameById = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const paymentNameById = useMemo(() => new Map(paymentInstruments.map((instrument) => [instrument.id, instrument.name])), [paymentInstruments]);
  const ticketHeader = useMemo(
    () => ({
      entryDate: ticketEntryDate,
      storeId: ticketStoreId,
      paymentInstrumentId: ticketPaymentInstrumentId,
    }),
    [ticketEntryDate, ticketPaymentInstrumentId, ticketStoreId],
  );
  const purchaseDateLabel = useMemo(() => {
    const purchaseDate = ticketHeader.entryDate;

    return purchaseDate ? formatPurchaseDate(purchaseDate) : 'Sin fecha';
  }, [ticketHeader.entryDate]);
  const storeLabel = useMemo(() => {
    const storeId = ticketHeader.storeId;

    return storeId ? storeNameById.get(storeId) ?? 'Sin tienda' : 'Sin tienda';
  }, [storeNameById, ticketHeader.storeId]);
  const paymentLabel = useMemo(() => {
    const paymentInstrumentId = ticketHeader.paymentInstrumentId;

    return paymentInstrumentId ? paymentNameById.get(paymentInstrumentId) ?? 'Sin pago' : 'Sin pago';
  }, [paymentNameById, ticketHeader.paymentInstrumentId]);
  const selectedRows = useMemo(() => rows.filter((row) => row.selected), [rows]);
  const selectedRowCount = selectedRows.length;
  const areAllRowsSelected = rows.length > 0 && selectedRowCount === rows.length;
  const selectedTicketTotalLabel = useMemo(() => {
    const totalAmount = selectedRows.reduce((sum, row) => {
      const rowTotal = Number(row.totalAmountMxn);

      return Number.isFinite(rowTotal) ? sum + rowTotal : sum;
    }, 0);

    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 2,
    }).format(totalAmount);
  }, [selectedRows]);
  const canSelectImage = !previewUrl && !currentTicketId && !isProcessing && !isSaving && !isCatalogsLoading;
  const canRetryProcessing = Boolean(currentStoragePath && currentTicketStatus === 'error' && !isProcessing && !isSaving);
  const canAddProduct = Boolean(currentTicketId && !isProcessing && !isSaving && currentTicketStatus !== 'saved');
  const isReviewEditable = currentTicketStatus !== 'saved' && !isProcessing && !isSaving;
  const isTicketHeaderEditable = Boolean(currentTicketId && isReviewEditable);
  const saveExpensesActionLabel = isSaving
    ? 'Guardando egresos'
    : currentTicketStatus === 'saved'
      ? 'Egresos guardados'
      : selectedRowCount === 0
        ? 'Selecciona filas para guardar'
        : 'Guardar egresos';

  function setTicketHeaderState(header: TicketHeaderState) {
    setTicketEntryDate(header.entryDate);
    setTicketStoreId(header.storeId);
    setTicketPaymentInstrumentId(header.paymentInstrumentId);
  }

  async function persistTicketHeader(header: TicketHeaderState, failurePrefix = 'No fue posible actualizar la cabecera del ticket.') {
    if (!supabase || !currentTicketId) {
      return true;
    }

    const { error } = await supabase
      .from('tickets')
      .update({
        entry_date: header.entryDate || null,
        store_id: header.storeId || null,
        payment_instrument_id: header.paymentInstrumentId || null,
      })
      .eq('id', currentTicketId);

    if (error) {
      setFeedback(`${failurePrefix} ${error.message}`);
      return false;
    }

    return true;
  }

  function handleTicketHeaderChange<K extends keyof TicketHeaderState>(field: K, value: TicketHeaderState[K]) {
    const nextHeader = {
      ...ticketHeader,
      [field]: value,
    };

    setTicketHeaderState(nextHeader);
    setRows((currentRows) => applyTicketHeaderToRows(currentRows, nextHeader));

    if (currentTicketId && currentTicketStatus !== 'saved') {
      void persistTicketHeader(nextHeader);
    }
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

  function handleAddProduct() {
    const nextRow = createEmptyReviewRow({
      entryDate: ticketHeader.entryDate || getTodayDate(),
      storeId: ticketHeader.storeId,
      paymentInstrumentId: ticketHeader.paymentInstrumentId,
      currencyCode: rows[0]?.currencyCode ?? 'MXN',
    });

    setRows((currentRows) => [
      nextRow,
      ...currentRows,
    ]);
    focusCellEditor(0, 0, 'concept');
    setFeedback('Producto añadido.');
  }

  const handleToggleRowSelection = useCallback(
    (rowId: string, nextSelected: boolean) => {
      if (!isReviewEditable) {
        return;
      }

      setRows((currentRows) => currentRows.map((row) => (row.id === rowId ? { ...row, selected: nextSelected } : row)));
    },
    [isReviewEditable],
  );

  const handleToggleAllRows = useCallback(
    (nextSelected: boolean) => {
      if (!isReviewEditable) {
        return;
      }

      setRows((currentRows) => currentRows.map((row) => ({ ...row, selected: nextSelected })));
    },
    [isReviewEditable],
  );

  async function processTicketFromStoragePath(storagePath: string) {
    if (!supabase) {
      throw new Error('Supabase no está disponible para procesar tickets.');
    }

    const { data, error } = await supabase.functions.invoke('process-ticket', {
      body: {
        storage_path: storagePath,
      },
    });

    if (error) {
      throw error;
    }

    setCurrentTicketId(data.ticket_id as string);
    setCurrentTicketStatus('processed');
    setCurrentStoragePath(storagePath);
    const parsedRows = ((data.parsed_expenses ?? []) as ParsedTicketExpense[]).map(toReviewRow);
    const fallbackHeader = getTicketHeaderFromRows(parsedRows);
    const nextHeader = {
      entryDate: (data.entry_date as string | null) ?? fallbackHeader.entryDate,
      storeId: (data.store_id as string | null) ?? fallbackHeader.storeId,
      paymentInstrumentId: (data.payment_instrument_id as string | null) ?? fallbackHeader.paymentInstrumentId,
    };

    setTicketHeaderState(nextHeader);
    setRows(applyTicketHeaderToRows(parsedRows, nextHeader));
    setFeedback('Ticket procesado.');
  }

  async function handleFileSelection(file: File) {
    if (!supabase || !user) {
      setFeedback('Necesitas una sesión válida para subir tickets.');
      return;
    }

    try {
      setIsProcessing(true);
      setFeedback(null);

      const compressedImage = await compressTicketImage(file);
      const nextPreviewUrl = URL.createObjectURL(file);
      setPreviewUrl((currentPreviewUrl) => {
        if (currentPreviewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(currentPreviewUrl);
        }

        return nextPreviewUrl;
      });

      const safeBaseName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket';
      const storagePath = `${user.id}/${Date.now()}-${safeBaseName.replace(/\.[^.]+$/, '')}.jpg`;
      const { error: uploadError } = await supabase.storage.from('tickets').upload(storagePath, compressedImage, {
        contentType: 'image/jpeg',
        upsert: false,
      });

      if (uploadError) {
        throw uploadError;
      }

      setCurrentStoragePath(storagePath);
      await processTicketFromStoragePath(storagePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible procesar el ticket.';
      setCurrentTicketStatus('error');
      setFeedback(`No fue posible procesar el ticket: ${message}`);
    } finally {
      setIsProcessing(false);
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }

      if (galleryInputRef.current) {
        galleryInputRef.current.value = '';
      }
    }
  }

  function openCameraPicker() {
    cameraInputRef.current?.click();
  }

  function openGalleryPicker() {
    galleryInputRef.current?.click();
  }

  async function handleRetryProcessing() {
    if (!currentStoragePath) {
      return;
    }

    try {
      setIsProcessing(true);
      setFeedback(null);
      setRows([]);
      await processTicketFromStoragePath(currentStoragePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible reprocesar el ticket.';
      setCurrentTicketStatus('error');
      setFeedback(`No fue posible reprocesar el ticket: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSaveExpenses() {
    if (!supabase) {
      setFeedback('Supabase no está disponible para guardar egresos.');
      return;
    }

    if (currentTicketStatus === 'saved') {
      setFeedback('Este ticket ya fue marcado como guardado. Evita guardar los egresos dos veces.');
      return;
    }

    if (!currentTicketId) {
      setFeedback('No hay un ticket persistido asociado al proceso actual.');
      return;
    }

    if (rows.length === 0) {
      setFeedback('No hay gastos detectados para guardar.');
      return;
    }

    const selectedReviewRows = rows.filter((row) => row.selected);

    if (selectedReviewRows.length === 0) {
      setFeedback('Selecciona al menos una fila para guardar.');
      return;
    }

    const invalidRowIndex = rows.findIndex((row) => row.selected && validateReviewRow(row) != null);

    if (invalidRowIndex >= 0) {
      setFeedback(`La fila ${invalidRowIndex + 1} seleccionada necesita correcciones: ${validateReviewRow(rows[invalidRowIndex])}.`);
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    if (!ticketHeader.entryDate || !isIsoDateString(ticketHeader.entryDate)) {
      setFeedback('La cabecera del ticket necesita una fecha válida.');
      setIsSaving(false);
      return;
    }

    const headerSaved = await persistTicketHeader(ticketHeader, 'No fue posible actualizar la cabecera del ticket antes de guardar.');

    if (!headerSaved) {
      setIsSaving(false);
      return;
    }

    const payload = selectedReviewRows.map((row) => {
      const subtotalOriginal = Number(row.subtotalOriginal);
      const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

      return {
        entry_date: ticketHeader.entryDate,
        concept: row.concept.trim(),
        quantity: Number(row.quantity),
        unit_of_measure: unitNameById.get(row.unitOfMeasureId) ?? null,
        unit_of_measure_id: row.unitOfMeasureId || null,
        subtotal_original: Number(subtotalOriginal.toFixed(6)),
        currency_code: row.currencyCode,
        fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : fxRateToMxn,
        total_amount_mxn: Number((subtotalOriginal * fxRateToMxn).toFixed(6)),
        payment_instrument_id: ticketHeader.paymentInstrumentId || null,
        store_id: ticketHeader.storeId || null,
        category_id: row.categoryId || null,
        ticket_url: currentTicketId,
        notes: row.notes.trim() || null,
      };
    });

    const { error: insertError } = await supabase.from('expense_entries').insert(payload);

    if (insertError) {
      setFeedback(`No fue posible guardar los egresos aprobados: ${insertError.message}`);
      setIsSaving(false);
      return;
    }

    if (currentTicketId) {
      const { error: ticketUpdateError } = await supabase
        .from('tickets')
        .update({
          status: 'saved',
          error_message: null,
        })
        .eq('id', currentTicketId);

      if (ticketUpdateError) {
        setCurrentTicketStatus('processed');
        setFeedback(
          'Los egresos se guardaron, pero no se pudo marcar el ticket como guardado. No repitas el guardado; revisa el historial.',
        );
        setIsSaving(false);
        return;
      }
    }

    setCurrentTicketStatus('saved');

    navigate('/tickets');
  }

  const columns = useMemo<readonly Column<ReviewRow>[]>(
    () => [
      {
        key: 'selected',
        name: '',
        width: 44,
        frozen: true,
        editable: false,
        renderHeaderCell: () => (
          <div className="ticket-review-checkbox">
            <input
              type="checkbox"
              aria-label="Seleccionar todas las filas"
              checked={areAllRowsSelected}
              disabled={rows.length === 0 || !isReviewEditable}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                handleToggleAllRows(event.target.checked);
              }}
            />
          </div>
        ),
        renderCell: ({ row }) => (
          <div className="ticket-review-checkbox">
            <input
              type="checkbox"
              checked={row.selected}
              disabled={!isReviewEditable}
              aria-label={`Seleccionar fila ${row.concept.trim() || 'sin concepto'}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                handleToggleRowSelection(row.id, event.target.checked);
              }}
            />
          </div>
        ),
      },
      {
        key: 'concept',
        name: 'Concepto',
        width: 220,
        editable: isReviewEditable,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="text" />,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: 82,
        editable: isReviewEditable,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" />,
      },
      {
        key: 'unitOfMeasureId',
        name: 'Unidad',
        width: 110,
        editable: isReviewEditable,
        renderCell: ({ row }) => unitOptions.find((option) => option.value === row.unitOfMeasureId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={unitOptions} />,
      },
      {
        key: 'categoryId',
        name: 'Categoría',
        width: 130,
        editable: isReviewEditable,
        renderCell: ({ row }) => categoryOptions.find((option) => option.value === row.categoryId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={categoryOptions} />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: 88,
        editable: isReviewEditable,
        renderEditCell: (props) => <SelectCellEditor {...props} options={currencyOptions} />,
      },
      {
        key: 'subtotalOriginal',
        name: 'Subtotal',
        width: 96,
        editable: isReviewEditable,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" step="0.01" />,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX',
        width: 90,
        editable: isReviewEditable,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.000001" />,
      },
      {
        key: 'totalAmountMxn',
        name: 'MXN',
        width: 96,
        editable: false,
      },
      {
        key: 'notes',
        name: 'Notas',
        width: 180,
        editable: isReviewEditable,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="text" />,
      },
    ],
    [areAllRowsSelected, categoryOptions, currencyOptions, handleToggleAllRows, handleToggleRowSelection, isReviewEditable, rows.length, unitOptions],
  );

  const handleNavigateToNextCell = useCallback(
    ({ rowIdx, columnIdx }: { rowIdx: number; columnIdx: number }) => {
      moveToNextEditableGridCell({
        gridRef,
        columns,
        rows,
        rowIdx,
        columnIdx,
      });
    },
    [columns, rows],
  );

  return (
    <div className="page">
      <section className="card tickets-hero tickets-hero--scan">
        <div className="tickets-hero__heading">
          <h3 className="card__title">Escanear ticket</h3>
          <div className="ticket-card__meta">
            <span className={`status-pill status-pill--${getStatusTone(currentTicketStatus ?? (isProcessing ? 'processing' : 'pending'))}`}>
              {formatStatusLabel(currentTicketStatus ?? (isProcessing ? 'processing' : 'pending'))}
            </span>
            <span className="badge ticket-card__badge" title="Fecha de compra">
              <FontAwesomeIcon icon={faCalendarDay} />
              <span>{purchaseDateLabel}</span>
            </span>
            <span className="badge ticket-card__badge" title="Tienda">
              <FontAwesomeIcon icon={faShop} />
              <span>{storeLabel}</span>
            </span>
            <span className="badge ticket-card__badge" title="Instrumento de pago">
              <FontAwesomeIcon icon={faCreditCard} />
              <span>{paymentLabel}</span>
            </span>
            <span className="badge ticket-card__badge" title="Filas seleccionadas / detectadas">
              <FontAwesomeIcon icon={faReceipt} />
              <span>{rows.length === 0 ? '0' : `${selectedRowCount}/${rows.length}`}</span>
            </span>
            <span className="badge ticket-card__badge" title="Total seleccionado en MXN">
              <span>{selectedTicketTotalLabel}</span>
            </span>
          </div>
        </div>

        <div className="tickets-hero__actions">
          {canSelectImage ? (
            <>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleFileSelection(file);
                  }
                }}
                disabled={!canSelectImage}
                hidden
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleFileSelection(file);
                  }
                }}
                disabled={!canSelectImage}
                hidden
              />
              <button
                type="button"
                className="tickets-button tickets-button--primary tickets-button--icon"
                aria-label="Tomar foto"
                title="Tomar foto"
                onClick={openCameraPicker}
                disabled={!canSelectImage}
              >
                <FontAwesomeIcon icon={faCamera} />
              </button>
              <button
                type="button"
                className="tickets-button tickets-button--icon"
                aria-label="Elegir imagen"
                title="Elegir imagen"
                onClick={openGalleryPicker}
                disabled={!canSelectImage}
              >
                <FontAwesomeIcon icon={faImage} />
              </button>
            </>
          ) : null}
          {canRetryProcessing ? (
            <button
              type="button"
              className="tickets-button tickets-button--icon"
              onClick={() => {
                void handleRetryProcessing();
              }}
              aria-label="Reintentar procesamiento"
              title="Reintentar procesamiento"
            >
              <FontAwesomeIcon icon={faArrowRotateRight} />
            </button>
          ) : null}
          <Link to="/tickets" className="tickets-button tickets-button--icon" aria-label="Volver" title="Volver">
            <FontAwesomeIcon icon={faArrowLeft} />
          </Link>
        </div>
      </section>

      <section className="tickets-scan-layout">
        <article className="card tickets-scan-panel">
          {previewUrl ? (
            <div className="tickets-preview-frame tickets-preview-frame--full">
              <button
                type="button"
                className="tickets-preview-frame__trigger"
                onClick={() => setIsImageViewerOpen(true)}
                aria-label="Ver ticket en grande"
                title="Ver ticket en grande"
              >
                <img src={previewUrl} alt="Preview del ticket seleccionado" className="tickets-preview-frame__image" />
              </button>
            </div>
          ) : (
            <div className="tickets-preview-frame tickets-preview-frame--empty">Sin imagen</div>
          )}

          {feedback ? <div className={isErrorFeedback(feedback) || currentTicketStatus === 'error' ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        </article>

        <article className="card tickets-review-panel">
          <div className="dashboard-panel__header">
            <h3 className="card__title">Revisión</h3>
            <div className="tickets-hero__actions">
              <button
                type="button"
                className="tickets-button tickets-button--icon"
                onClick={handleAddProduct}
                disabled={!canAddProduct}
                aria-label="Añadir producto"
                title="Añadir producto"
              >
                <FontAwesomeIcon icon={faPlus} />
              </button>
              <button
                type="button"
                className="tickets-button tickets-button--primary tickets-button--icon"
                onClick={() => void handleSaveExpenses()}
                disabled={selectedRowCount === 0 || isProcessing || isSaving || currentTicketStatus === 'saved'}
                aria-label={saveExpensesActionLabel}
                title={saveExpensesActionLabel}
              >
                <FontAwesomeIcon icon={isSaving ? faCloudArrowUp : faFloppyDisk} />
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="tickets-review-empty">
              <p className="card__text">
                {isProcessing ? 'Procesando...' : ticketId ? 'Sin filas.' : 'Carga una imagen.'}
              </p>
            </div>
          ) : (
            <>
              <div className="finance-form tickets-bulk-fields">
                <div className="tickets-bulk-fields__field">
                  <span className="tickets-bulk-fields__label" title="Fecha común">
                    <FontAwesomeIcon icon={faCalendarDay} />
                  </span>
                  <AppDatePicker
                    className="dashboard-filters__control tickets-bulk-fields__control"
                    ariaLabel="Fecha común"
                    value={ticketHeader.entryDate}
                    onChange={(value) => handleTicketHeaderChange('entryDate', value)}
                    placeholder="AAAA-MM-DD"
                    disabled={!isTicketHeaderEditable}
                  />
                </div>

                <div className="tickets-bulk-fields__field">
                  <span className="tickets-bulk-fields__label" title="Tienda común">
                    <FontAwesomeIcon icon={faShop} />
                  </span>
                  <AppSelect
                    ariaLabel="Tienda común"
                    options={storeOptions}
                    value={ticketHeader.storeId}
                    onChange={(value) => handleTicketHeaderChange('storeId', value)}
                    placeholder="Tienda"
                    isDisabled={!isTicketHeaderEditable}
                  />
                </div>

                <div className="tickets-bulk-fields__field">
                  <span className="tickets-bulk-fields__label" title="Pago común">
                    <FontAwesomeIcon icon={faCreditCard} />
                  </span>
                  <AppSelect
                    ariaLabel="Pago común"
                    options={paymentInstrumentOptions}
                    value={ticketHeader.paymentInstrumentId}
                    onChange={(value) => handleTicketHeaderChange('paymentInstrumentId', value)}
                    placeholder="Pago"
                    isDisabled={!isTicketHeaderEditable}
                  />
                </div>
              </div>

              <div className="grid-wrapper grid-wrapper--tall">
                <GridEditorNavigationProvider onNavigateToNextCell={handleNavigateToNextCell}>
                  <DataGrid
                    ref={gridRef}
                    columns={columns}
                    rows={rows}
                    rowHeight={GRID_ROW_HEIGHT}
                    headerRowHeight={GRID_ROW_HEIGHT}
                    rowKeyGetter={(row) => row.id}
                    onRowsChange={(nextRows) => {
                      if (!isReviewEditable) {
                        return;
                      }

                      const normalizedRows = nextRows.map(normalizeReviewRow);
                      const autoSwitchedCurrency = nextRows.some((row, index) => row.currencyCode === 'MXN' && normalizedRows[index]?.currencyCode === 'USD');

                      setRows(normalizedRows);

                      if (autoSwitchedCurrency) {
                        setFeedback(FX_AUTO_SWITCH_FEEDBACK);
                      }
                    }}
                    onCellClick={(args) => {
                      if (isReviewEditable && args.column.renderEditCell) {
                        args.selectCell(true);
                      }
                    }}
                    defaultColumnOptions={{ resizable: true }}
                    style={{ blockSize: 500 }}
                  />
                </GridEditorNavigationProvider>
              </div>
            </>
          )}
        </article>
      </section>

      {isImageViewerOpen && previewUrl ? (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Visor de ticket"
          onClick={() => setIsImageViewerOpen(false)}
        >
          <div className="image-viewer__content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="image-viewer__close"
              onClick={() => setIsImageViewerOpen(false)}
              aria-label="Cerrar visor"
              title="Cerrar visor"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <img src={previewUrl} alt="Ticket en vista ampliada" className="image-viewer__image" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
