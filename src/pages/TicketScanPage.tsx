import { useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRotateRight, faArrowLeft, faCalendarDay, faCamera, faCloudArrowUp, faCreditCard, faFloppyDisk, faReceipt, faShop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column } from 'react-data-grid';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { InputCellEditor, SelectCellEditor, type SelectOption } from '../features/shared/gridEditors';
import { isIsoDateString } from '../features/shared/isoDate';
import type { ParsedTicketExpense, TicketRecord, TicketStatus } from '../features/tickets/types';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';

type ExpenseCategory = { id: string; name: string };
type PaymentInstrument = { id: string; name: string };
type Store = { id: string; name: string };
type UnitOfMeasure = { id: string; name: string };

type ReviewRow = {
  id: string;
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

const GRID_ROW_HEIGHT = 30;

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
  const fxRateToMxn = row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn;
  const subtotalOriginal = Number(row.subtotalOriginal);
  const fxRate = Number(fxRateToMxn);

  return {
    ...row,
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
    return 'usa una fecha valida en formato AAAA-MM-DD';
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isCatalogsLoading, setIsCatalogsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        setFeedback('Supabase no esta configurado en este entorno.');
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
        setFeedback(`No fue posible cargar los catalogos necesarios: ${firstError.message}`);
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
        .select('id, storage_path, status, raw_llm_response, parsed_expenses, error_message, created_at')
        .eq('id', ticketId)
        .single();

      if (error || !data) {
        setFeedback(`No fue posible cargar el ticket solicitado: ${error?.message ?? 'no encontrado'}`);
        setIsProcessing(false);
        return;
      }

      const ticket = data as TicketRecord;
      setCurrentTicketId(ticket.id);
      setCurrentTicketStatus(ticket.status);
      setCurrentStoragePath(ticket.storage_path);
      setRows((ticket.parsed_expenses ?? []).map(toReviewRow));
      setFeedback(ticket.error_message ?? null);

      const { data: signedUrlData } = await supabase.storage.from('tickets').createSignedUrl(ticket.storage_path, 3600);
      setPreviewUrl(signedUrlData?.signedUrl ?? null);
      setIsProcessing(false);
    }

    void loadTicketFromHistory();
  }, [ticketId]);

  const categoryOptions = useMemo<readonly SelectOption[]>(
    () => [{ value: '', label: 'Sin categoria' }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
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
  const purchaseDateLabel = useMemo(() => {
    const purchaseDate = rows.find((row) => row.entryDate)?.entryDate;

    return purchaseDate ? formatPurchaseDate(purchaseDate) : 'Sin fecha';
  }, [rows]);
  const storeLabel = useMemo(() => {
    const storeId = rows.find((row) => row.storeId)?.storeId;

    return storeId ? storeNameById.get(storeId) ?? 'Sin tienda' : 'Sin tienda';
  }, [rows, storeNameById]);
  const paymentLabel = useMemo(() => {
    const paymentInstrumentId = rows.find((row) => row.paymentInstrumentId)?.paymentInstrumentId;

    return paymentInstrumentId ? paymentNameById.get(paymentInstrumentId) ?? 'Sin pago' : 'Sin pago';
  }, [paymentNameById, rows]);
  const canSelectImage = !previewUrl && !currentTicketId && !isProcessing && !isSaving && !isCatalogsLoading;
  const canRetryProcessing = Boolean(currentStoragePath && currentTicketStatus === 'error' && !isProcessing && !isSaving);

  async function processTicketFromStoragePath(storagePath: string) {
    if (!supabase) {
      throw new Error('Supabase no esta disponible para procesar tickets.');
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
    setRows(((data.parsed_expenses ?? []) as ParsedTicketExpense[]).map(toReviewRow));
    setFeedback('Ticket procesado.');
  }

  async function handleFileSelection(file: File) {
    if (!supabase || !user) {
      setFeedback('Necesitas una sesion valida para subir tickets.');
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
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
      setFeedback('Supabase no esta disponible para guardar egresos.');
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

    const invalidRowIndex = rows.findIndex((row) => validateReviewRow(row) != null);

    if (invalidRowIndex >= 0) {
      setFeedback(`La fila ${invalidRowIndex + 1} necesita correcciones: ${validateReviewRow(rows[invalidRowIndex])}.`);
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    const payload = rows.map((row) => {
      const subtotalOriginal = Number(row.subtotalOriginal);
      const fxRateToMxn = Number(row.currencyCode === 'MXN' ? '1' : row.fxRateToMxn);

      return {
        entry_date: row.entryDate,
        concept: row.concept.trim(),
        quantity: Number(row.quantity),
        unit_of_measure: unitNameById.get(row.unitOfMeasureId) ?? null,
        unit_of_measure_id: row.unitOfMeasureId || null,
        subtotal_original: Number(subtotalOriginal.toFixed(6)),
        currency_code: row.currencyCode,
        fx_rate_to_mxn: row.currencyCode === 'MXN' ? null : fxRateToMxn,
        total_amount_mxn: Number((subtotalOriginal * fxRateToMxn).toFixed(6)),
        payment_instrument_id: row.paymentInstrumentId || null,
        store_id: row.storeId || null,
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
        key: 'entryDate',
        name: 'Fecha',
        width: 96,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="iso-date" />,
      },
      {
        key: 'concept',
        name: 'Concepto',
        width: 220,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="text" />,
      },
      {
        key: 'quantity',
        name: 'Cantidad',
        width: 82,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" min="0" step="0.01" />,
      },
      {
        key: 'unitOfMeasureId',
        name: 'Unidad',
        width: 110,
        renderCell: ({ row }) => unitOptions.find((option) => option.value === row.unitOfMeasureId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={unitOptions} />,
      },
      {
        key: 'categoryId',
        name: 'Categoria',
        width: 130,
        renderCell: ({ row }) => categoryOptions.find((option) => option.value === row.categoryId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={categoryOptions} />,
      },
      {
        key: 'paymentInstrumentId',
        name: 'Pago',
        width: 130,
        renderCell: ({ row }) => paymentInstrumentOptions.find((option) => option.value === row.paymentInstrumentId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={paymentInstrumentOptions} />,
      },
      {
        key: 'storeId',
        name: 'Tienda',
        width: 120,
        renderCell: ({ row }) => storeOptions.find((option) => option.value === row.storeId)?.label ?? '-',
        renderEditCell: (props) => <SelectCellEditor {...props} options={storeOptions} />,
      },
      {
        key: 'currencyCode',
        name: 'Moneda',
        width: 88,
        renderEditCell: (props) => <SelectCellEditor {...props} options={currencyOptions} />,
      },
      {
        key: 'subtotalOriginal',
        name: 'Subtotal',
        width: 96,
        renderEditCell: (props) => <InputCellEditor {...props} inputType="number" step="0.01" />,
      },
      {
        key: 'fxRateToMxn',
        name: 'FX',
        width: 90,
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
        renderEditCell: (props) => <InputCellEditor {...props} inputType="text" />,
      },
    ],
    [categoryOptions, currencyOptions, paymentInstrumentOptions, storeOptions, unitOptions],
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
            <span className="badge ticket-card__badge" title="Gastos detectados">
              <FontAwesomeIcon icon={faReceipt} />
              <span>{rows.length}</span>
            </span>
          </div>
        </div>

        <div className="tickets-hero__actions">
          {canSelectImage ? (
            <label
              className="tickets-button tickets-button--primary tickets-button--icon"
              aria-label="Seleccionar ticket"
              title="Seleccionar ticket"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void handleFileSelection(file);
                  }
                }}
                disabled={!canSelectImage}
              />
              <FontAwesomeIcon icon={faCamera} />
            </label>
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

          {feedback ? <div className={feedback.includes('No fue posible') ? 'feedback-banner feedback-banner--error' : 'feedback-banner'}>{feedback}</div> : null}
        </article>

        <article className="card tickets-review-panel">
          <div className="dashboard-panel__header">
            <h3 className="card__title">Revision</h3>
            <div className="tickets-hero__actions">
              <button
                type="button"
                className="tickets-button tickets-button--primary tickets-button--icon"
                onClick={() => void handleSaveExpenses()}
                disabled={rows.length === 0 || isProcessing || isSaving || currentTicketStatus === 'saved'}
                aria-label={isSaving ? 'Guardando egresos' : currentTicketStatus === 'saved' ? 'Egresos guardados' : 'Guardar egresos'}
                title={isSaving ? 'Guardando egresos' : currentTicketStatus === 'saved' ? 'Egresos guardados' : 'Guardar egresos'}
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
              <div className="badge-row">
                <span className="badge">{rows.length} filas</span>
                {currentTicketStatus === 'saved' ? <span className="badge">Guardado</span> : null}
              </div>

              <div className="grid-wrapper grid-wrapper--tall">
                <DataGrid
                  columns={columns}
                  rows={rows}
                  rowHeight={GRID_ROW_HEIGHT}
                  headerRowHeight={GRID_ROW_HEIGHT}
                  rowKeyGetter={(row) => row.id}
                  onRowsChange={(nextRows) => setRows(nextRows.map(normalizeReviewRow))}
                  onCellClick={(args) => {
                    if (args.column.renderEditCell) {
                      args.selectCell(true);
                    }
                  }}
                  defaultColumnOptions={{ resizable: true }}
                  style={{ blockSize: 500 }}
                />
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
