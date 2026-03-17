update public.expense_entries as expense_entries
set ticket_url = tickets.id::text
from public.tickets as tickets
where expense_entries.ticket_url is not null
  and expense_entries.ticket_url = tickets.storage_path;

comment on column public.expense_entries.ticket_url is 'Stores the related tickets.id as text when the expense originated from a scanned ticket.';