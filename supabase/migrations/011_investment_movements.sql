create table if not exists public.stock_buys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_date date not null,
  broker_id uuid not null references public.brokers(id),
  investment_entity_id uuid not null references public.investment_entities(id),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  quantity numeric(18, 6) not null check (quantity > 0),
  unit_price_original numeric(18, 6) not null check (unit_price_original > 0),
  fees_original numeric(18, 6) not null default 0 check (fees_original >= 0),
  fx_rate_to_mxn numeric(18, 6),
  total_amount_mxn numeric(18, 6) not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_sells (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_date date not null,
  broker_id uuid not null references public.brokers(id),
  investment_entity_id uuid not null references public.investment_entities(id),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  quantity numeric(18, 6) not null check (quantity > 0),
  unit_price_original numeric(18, 6) not null check (unit_price_original > 0),
  fees_original numeric(18, 6) not null default 0 check (fees_original >= 0),
  fx_rate_to_mxn numeric(18, 6),
  total_amount_mxn numeric(18, 6) not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.dividend_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  broker_id uuid not null references public.brokers(id),
  investment_entity_id uuid not null references public.investment_entities(id),
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  gross_amount_original numeric(18, 6) not null check (gross_amount_original >= 0),
  tax_withheld_original numeric(18, 6) not null default 0 check (tax_withheld_original >= 0),
  fx_rate_to_mxn numeric(18, 6),
  net_amount_mxn numeric(18, 6) not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists stock_buys_user_id_idx on public.stock_buys(user_id);
create index if not exists stock_buys_trade_date_idx on public.stock_buys(trade_date desc);
create index if not exists stock_buys_entity_idx on public.stock_buys(investment_entity_id);
create index if not exists stock_sells_user_id_idx on public.stock_sells(user_id);
create index if not exists stock_sells_trade_date_idx on public.stock_sells(trade_date desc);
create index if not exists stock_sells_entity_idx on public.stock_sells(investment_entity_id);
create index if not exists dividend_entries_user_id_idx on public.dividend_entries(user_id);
create index if not exists dividend_entries_entry_date_idx on public.dividend_entries(entry_date desc);
create index if not exists dividend_entries_entity_idx on public.dividend_entries(investment_entity_id);

grant select, insert, update, delete on public.stock_buys to authenticated;
grant select, insert, update, delete on public.stock_sells to authenticated;
grant select, insert, update, delete on public.dividend_entries to authenticated;

alter table public.stock_buys enable row level security;
alter table public.stock_sells enable row level security;
alter table public.dividend_entries enable row level security;

drop policy if exists stock_buys_select_own on public.stock_buys;
drop policy if exists stock_buys_insert_own on public.stock_buys;
drop policy if exists stock_buys_update_own on public.stock_buys;
drop policy if exists stock_buys_delete_own on public.stock_buys;
create policy stock_buys_select_own on public.stock_buys for select to authenticated using (user_id = auth.uid());
create policy stock_buys_insert_own on public.stock_buys for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = stock_buys.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy stock_buys_update_own on public.stock_buys for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = stock_buys.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy stock_buys_delete_own on public.stock_buys for delete to authenticated using (user_id = auth.uid());

drop policy if exists stock_sells_select_own on public.stock_sells;
drop policy if exists stock_sells_insert_own on public.stock_sells;
drop policy if exists stock_sells_update_own on public.stock_sells;
drop policy if exists stock_sells_delete_own on public.stock_sells;
create policy stock_sells_select_own on public.stock_sells for select to authenticated using (user_id = auth.uid());
create policy stock_sells_insert_own on public.stock_sells for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = stock_sells.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy stock_sells_update_own on public.stock_sells for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = stock_sells.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy stock_sells_delete_own on public.stock_sells for delete to authenticated using (user_id = auth.uid());

drop policy if exists dividend_entries_select_own on public.dividend_entries;
drop policy if exists dividend_entries_insert_own on public.dividend_entries;
drop policy if exists dividend_entries_update_own on public.dividend_entries;
drop policy if exists dividend_entries_delete_own on public.dividend_entries;
create policy dividend_entries_select_own on public.dividend_entries for select to authenticated using (user_id = auth.uid());
create policy dividend_entries_insert_own on public.dividend_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = dividend_entries.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy dividend_entries_update_own on public.dividend_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.investment_entities where investment_entities.id = dividend_entries.investment_entity_id and investment_entities.user_id = auth.uid()
  )
);
create policy dividend_entries_delete_own on public.dividend_entries for delete to authenticated using (user_id = auth.uid());