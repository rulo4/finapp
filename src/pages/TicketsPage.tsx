import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faEye, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { DataGrid, type Column } from 'react-data-grid';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';
import type { TicketRecord, TicketStatus } from '../features/tickets/types';

type TicketGridRow = TicketRecord & {
  previewUrl: string | null;
  purchaseDateLabel: string;
  storeLabel: string;
  paymentLabel: string;
  expenseCount: number;
};

const GRID_ROW_HEIGHT = 64;
const ACTION_COLUMN_WIDTH = 72;
const THUMBNAIL_COLUMN_WIDTH = 92;

function getStatusLabel(status: TicketStatus) {
  switch (status) {
    case 'saved':
      return 'Guardado';
    case 'processing':
      return 'Procesando';
    case 'processed':
      return 'Listo para guardar';
    case 'error':
      return 'Error';
    default:
      return 'Pendiente';
  }
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

function formatPurchaseDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00`));
}

function getTicketPurchaseDate(ticket: TicketRecord) {
  const purchaseDate = ticket.parsed_expenses?.find((expense) => expense.entry_date)?.entry_date;

  return purchaseDate ? formatPurchaseDate(purchaseDate) : 'Sin fecha';
}

function getTicketStore(ticket: TicketRecord) {
  return ticket.parsed_expenses?.find((expense) => expense.suggested_store_text?.trim())?.suggested_store_text?.trim() ?? 'Sin tienda';
}

function getTicketPaymentInstrument(ticket: TicketRecord) {
  return (
    ticket.parsed_expenses
      ?.find((expense) => expense.suggested_payment_instrument_text?.trim())
      ?.suggested_payment_instrument_text?.trim() ?? 'Sin pago'
  );
}

function isMissingStorageObjectMessage(message: string) {
  return /not found|does not exist|no such object/i.test(message);
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<TicketGridRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);
  const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!viewerImageUrl) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setViewerImageUrl(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewerImageUrl]);

  async function loadTickets() {
    const activeSupabase = supabase;

    if (!activeSupabase || !isSupabaseConfigured()) {
      setFeedback('Supabase no esta configurado en este entorno.');
      setTickets([]);
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const { data, error } = await activeSupabase
      .from('tickets')
      .select('id, storage_path, status, raw_llm_response, parsed_expenses, error_message, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      setTickets([]);
      setFeedback(`No fue posible cargar el historial de tickets: ${error.message}`);
      setIsLoading(false);
      return;
    }

    const records = (data ?? []) as TicketRecord[];
    const signedUrls = await Promise.all(
      records.map(async (ticket) => {
        const { data: signedUrlData } = await activeSupabase.storage.from('tickets').createSignedUrl(ticket.storage_path, 3600);

        return {
          id: ticket.id,
          previewUrl: signedUrlData?.signedUrl ?? null,
        };
      }),
    );
    const previewById = new Map(signedUrls.map((entry) => [entry.id, entry.previewUrl]));

    setTickets(
      records.map((ticket) => ({
        ...ticket,
        previewUrl: previewById.get(ticket.id) ?? null,
        purchaseDateLabel: getTicketPurchaseDate(ticket),
        storeLabel: getTicketStore(ticket),
        paymentLabel: getTicketPaymentInstrument(ticket),
        expenseCount: ticket.parsed_expenses?.length ?? 0,
      })),
    );
    setIsLoading(false);
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  async function handleDeleteTicket(ticket: TicketGridRow) {
    if (!supabase) {
      setFeedback('Supabase no esta disponible para eliminar tickets.');
      return;
    }

    if (ticket.status === 'saved') {
      setFeedback('No se pueden eliminar tickets cuyos egresos ya fueron guardados.');
      return;
    }

    const confirmed = window.confirm(
      'Se eliminara el ticket y su archivo asociado en Storage. Esta accion no se puede deshacer.',
    );

    if (!confirmed) {
      return;
    }

    setDeletingTicketId(ticket.id);
    setFeedback(null);

    try {
      if (ticket.storage_path) {
        const { error: storageError } = await supabase.storage.from('tickets').remove([ticket.storage_path]);

        if (storageError && !isMissingStorageObjectMessage(storageError.message)) {
          throw storageError;
        }
      }

      const { error: deleteError } = await supabase.from('tickets').delete().eq('id', ticket.id);

      if (deleteError) {
        throw deleteError;
      }

      setTickets((currentTickets) => currentTickets.filter((currentTicket) => currentTicket.id !== ticket.id));
      setFeedback('Ticket eliminado correctamente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible eliminar el ticket.';
      setFeedback(`No fue posible eliminar el ticket: ${message}`);
    } finally {
      setDeletingTicketId(null);
    }
  }

  const pendingSaveCount = useMemo(() => tickets.filter((ticket) => ticket.status === 'processed').length, [tickets]);
  const savedCount = useMemo(() => tickets.filter((ticket) => ticket.status === 'saved').length, [tickets]);

  const columns = useMemo<readonly Column<TicketGridRow>[]>(
    () => [
      {
        key: 'actions',
        name: '',
        width: ACTION_COLUMN_WIDTH,
        frozen: true,
        editable: false,
        renderCell: ({ row }) => {
          const actionCount = row.status === 'saved' ? 1 : 2;

          return (
            <div className={`grid-actions ticket-grid-actions grid-actions--${actionCount}`}>
              <Link
                to={`/tickets/scan?ticket=${row.id}`}
                className="grid-action grid-action--ticket"
                aria-label={row.status === 'saved' ? 'Ver ticket' : row.status === 'processed' ? 'Revisar ticket' : 'Abrir ticket'}
                title={row.status === 'saved' ? 'Ver ticket' : row.status === 'processed' ? 'Revisar ticket' : 'Abrir ticket'}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <FontAwesomeIcon icon={faEye} />
              </Link>
              {row.status !== 'saved' ? (
                <button
                  type="button"
                  className="grid-action grid-action--delete"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleDeleteTicket(row);
                  }}
                  disabled={deletingTicketId === row.id}
                  aria-label={deletingTicketId === row.id ? 'Eliminando ticket' : 'Eliminar ticket'}
                  title={deletingTicketId === row.id ? 'Eliminando ticket' : 'Eliminar ticket'}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'preview',
        name: 'Img',
        width: THUMBNAIL_COLUMN_WIDTH,
        editable: false,
        renderCell: ({ row }) =>
          row.previewUrl ? (
            <button
              type="button"
              className="ticket-grid-thumb__button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setViewerImageUrl(row.previewUrl);
              }}
              aria-label="Ver imagen del ticket"
              title="Ver imagen del ticket"
            >
              <img src={row.previewUrl} alt="Miniatura del ticket" className="ticket-grid-thumb__image" />
            </button>
          ) : (
            <div className="ticket-grid-thumb__placeholder">Sin img</div>
          ),
      },
      {
        key: 'status',
        name: 'Estado',
        width: 140,
        renderCell: ({ row }) => <span className={`ticket-grid-status ticket-grid-status--${getStatusTone(row.status)}`}>{getStatusLabel(row.status)}</span>,
      },
      {
        key: 'purchaseDateLabel',
        name: 'Fecha compra',
        width: 132,
      },
      {
        key: 'storeLabel',
        name: 'Tienda',
        width: 180,
      },
      {
        key: 'paymentLabel',
        name: 'Pago',
        width: 180,
      },
      {
        key: 'expenseCount',
        name: 'Gastos',
        width: 84,
      },
    ],
    [deletingTicketId],
  );

  return (
    <div className="page">
      <section className="card tickets-hero">
        <h3 className="card__title">Tickets</h3>
        <div className="tickets-hero__actions">
          <span className="status-pill status-pill--checking">{pendingSaveCount} listos para guardar</span>
          <span className="status-pill status-pill--ok">{savedCount} guardados</span>
          <Link
            to="/tickets/scan"
            className="tickets-button tickets-button--primary tickets-button--icon"
            aria-label="Escanear ticket"
            title="Escanear ticket"
          >
            <FontAwesomeIcon icon={faCamera} />
          </Link>
        </div>
      </section>

      {feedback ? <div className="feedback-banner feedback-banner--error">{feedback}</div> : null}

      <section className="card tickets-table-card">
        {isLoading ? (
          <p className="card__text">Cargando historial de tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="card__text">Sin tickets.</p>
        ) : (
          <div className="grid-wrapper grid-wrapper--tall">
            <DataGrid
              columns={columns}
              rows={tickets}
              rowHeight={GRID_ROW_HEIGHT}
              headerRowHeight={30}
              rowKeyGetter={(row) => row.id}
              defaultColumnOptions={{ resizable: true }}
              style={{ blockSize: 560 }}
            />
          </div>
        )}
      </section>

      {viewerImageUrl ? (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Visor de ticket"
          onClick={() => setViewerImageUrl(null)}
        >
          <div className="image-viewer__content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="image-viewer__close"
              onClick={() => setViewerImageUrl(null)}
              aria-label="Cerrar visor"
              title="Cerrar visor"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <img
              src={viewerImageUrl}
              alt="Vista ampliada del ticket"
              className="image-viewer__image"
              onClick={() => setViewerImageUrl(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
