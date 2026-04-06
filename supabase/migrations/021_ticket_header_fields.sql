alter table public.tickets
  add column if not exists entry_date date,
  add column if not exists store_id uuid references public.stores(id),
  add column if not exists payment_instrument_id uuid references public.payment_instruments(id);

update public.tickets
set entry_date = coalesce(
  entry_date,
  case
    when coalesce(parsed_expenses -> 0 ->> 'entry_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (parsed_expenses -> 0 ->> 'entry_date')::date
    else null
  end
),
store_id = coalesce(
  store_id,
  case
    when coalesce(parsed_expenses -> 0 ->> 'suggested_store_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1
        from public.stores
        where id = (parsed_expenses -> 0 ->> 'suggested_store_id')::uuid
      )
      then (parsed_expenses -> 0 ->> 'suggested_store_id')::uuid
    else null
  end
),
payment_instrument_id = coalesce(
  payment_instrument_id,
  case
    when coalesce(parsed_expenses -> 0 ->> 'suggested_payment_instrument_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and exists (
        select 1
        from public.payment_instruments
        where id = (parsed_expenses -> 0 ->> 'suggested_payment_instrument_id')::uuid
      )
      then (parsed_expenses -> 0 ->> 'suggested_payment_instrument_id')::uuid
    else null
  end
)
where entry_date is null
   or store_id is null
   or payment_instrument_id is null;

comment on column public.tickets.entry_date is 'Common purchase date shared by all items recognized from the ticket.';
comment on column public.tickets.store_id is 'Common store shared by all items recognized from the ticket.';
comment on column public.tickets.payment_instrument_id is 'Common payment instrument shared by all items recognized from the ticket.';