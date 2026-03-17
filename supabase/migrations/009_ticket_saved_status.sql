alter table public.tickets
  drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (status in ('pending', 'processing', 'processed', 'saved', 'error'));