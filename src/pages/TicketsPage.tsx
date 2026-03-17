import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDay, faCamera, faCreditCard, faEye, faReceipt, faShop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../lib/supabase/client';
import type { TicketRecord, TicketStatus } from '../features/tickets/types';

type TicketCard = TicketRecord & {
  previewUrl: string | null;
};

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

function getTicketPurchaseDate(ticket: TicketCard) {
  const purchaseDate = ticket.parsed_expenses?.find((expense) => expense.entry_date)?.entry_date;

  return purchaseDate ? formatPurchaseDate(purchaseDate) : 'Sin fecha';
}

function getTicketStore(ticket: TicketCard) {
  return ticket.parsed_expenses?.find((expense) => expense.suggested_store_text?.trim())?.suggested_store_text?.trim() ?? 'Sin tienda';
}

function getTicketPaymentInstrument(ticket: TicketCard) {
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
  const [tickets, setTickets] = useState<TicketCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);

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

    const records = ((data ?? []) as TicketRecord[]);
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

    setTickets(records.map((ticket) => ({ ...ticket, previewUrl: previewById.get(ticket.id) ?? null })));
    setIsLoading(false);
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  async function handleDeleteTicket(ticket: TicketCard) {
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

      <section className="tickets-list">
        {isLoading ? (
          <article className="card">
            <p className="card__text">Cargando historial de tickets...</p>
          </article>
        ) : tickets.length === 0 ? (
          <article className="card">
            <p className="card__text">Sin tickets.</p>
          </article>
        ) : (
          tickets.map((ticket) => (
            <article key={ticket.id} className="card ticket-card">
              <div className="ticket-card__preview">
                {ticket.previewUrl ? (
                  <img src={ticket.previewUrl} alt="Preview del ticket" className="ticket-card__image" />
                ) : (
                  <div className="ticket-card__placeholder">Sin preview</div>
                )}
              </div>

              <div className="ticket-card__content">
                <div className="ticket-card__row">
                  <div className="ticket-card__meta">
                    <span className={`status-pill status-pill--${getStatusTone(ticket.status)}`}>{getStatusLabel(ticket.status)}</span>
                  <span className="badge ticket-card__badge" title="Fecha de compra">
                    <FontAwesomeIcon icon={faCalendarDay} />
                    <span>{getTicketPurchaseDate(ticket)}</span>
                  </span>
                  <span className="badge ticket-card__badge" title="Tienda">
                    <FontAwesomeIcon icon={faShop} />
                    <span>{getTicketStore(ticket)}</span>
                  </span>
                  <span className="badge ticket-card__badge" title="Instrumento de pago">
                    <FontAwesomeIcon icon={faCreditCard} />
                    <span>{getTicketPaymentInstrument(ticket)}</span>
                  </span>
                  <span className="badge ticket-card__badge" title="Gastos detectados">
                    <FontAwesomeIcon icon={faReceipt} />
                    <span>{ticket.parsed_expenses?.length ?? 0}</span>
                  </span>
                  </div>

                  <div className="tickets-card__actions">
                    <Link
                      to={`/tickets/scan?ticket=${ticket.id}`}
                      className="tickets-button tickets-button--icon"
                      aria-label={ticket.status === 'saved' ? 'Ver ticket' : ticket.status === 'processed' ? 'Revisar ticket' : 'Abrir ticket'}
                      title={ticket.status === 'saved' ? 'Ver ticket' : ticket.status === 'processed' ? 'Revisar ticket' : 'Abrir ticket'}
                    >
                      <FontAwesomeIcon icon={faEye} />
                    </Link>
                    {ticket.status !== 'saved' ? (
                      <button
                        type="button"
                        className="tickets-button tickets-button--danger tickets-button--icon"
                        onClick={() => {
                          void handleDeleteTicket(ticket);
                        }}
                        disabled={deletingTicketId === ticket.id}
                        aria-label={deletingTicketId === ticket.id ? 'Eliminando ticket' : 'Eliminar ticket'}
                        title={deletingTicketId === ticket.id ? 'Eliminando ticket' : 'Eliminar ticket'}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    ) : null}
                  </div>
                </div>

                {ticket.error_message ? <div className="feedback-banner feedback-banner--error">{ticket.error_message}</div> : null}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
