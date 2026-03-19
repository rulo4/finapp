create table if not exists public.investment_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  investment_entity_id uuid not null references public.investment_entities(id),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  amount_original numeric(18, 6) not null check (amount_original <> 0),
  fx_rate_to_mxn numeric(18, 6),
  amount_mxn numeric(18, 6) not null check (amount_mxn <> 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists investment_movements_user_id_idx on public.investment_movements(user_id);
create index if not exists investment_movements_entry_date_idx on public.investment_movements(entry_date desc);
create index if not exists investment_movements_entity_idx on public.investment_movements(investment_entity_id);

grant select, insert, update, delete on public.investment_movements to authenticated;

alter table public.investment_movements enable row level security;

drop policy if exists investment_movements_select_own on public.investment_movements;
drop policy if exists investment_movements_insert_own on public.investment_movements;
drop policy if exists investment_movements_update_own on public.investment_movements;
drop policy if exists investment_movements_delete_own on public.investment_movements;

create policy investment_movements_select_own on public.investment_movements
for select to authenticated
using (user_id = auth.uid());

create policy investment_movements_insert_own on public.investment_movements
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.investment_entities
    where investment_entities.id = investment_movements.investment_entity_id
      and investment_entities.user_id = auth.uid()
  )
);

create policy investment_movements_update_own on public.investment_movements
for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.investment_entities
    where investment_entities.id = investment_movements.investment_entity_id
      and investment_entities.user_id = auth.uid()
  )
);

create policy investment_movements_delete_own on public.investment_movements
for delete to authenticated
using (user_id = auth.uid());
