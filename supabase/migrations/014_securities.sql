create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.securities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null,
  company_name text not null,
  sector text,
  industry text,
  exchange_code text,
  instrument_type text not null check (instrument_type in ('stock', 'etf', 'fibra', 'reit', 'adr', 'fund', 'other')),
  country_code text,
  currency_code text not null check (currency_code in ('MXN', 'USD')),
  website_url text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint securities_ticker_not_blank check (btrim(ticker) <> ''),
  constraint securities_company_name_not_blank check (btrim(company_name) <> '')
);

create index if not exists securities_user_id_idx on public.securities(user_id);
create index if not exists securities_ticker_idx on public.securities(user_id, upper(btrim(ticker)));
create index if not exists securities_sector_idx on public.securities(user_id, sector);
create index if not exists securities_industry_idx on public.securities(user_id, industry);
create unique index if not exists securities_user_id_exchange_ticker_idx
  on public.securities(user_id, coalesce(upper(btrim(exchange_code)), ''), upper(btrim(ticker)));

grant select, insert, update, delete on public.securities to authenticated;

alter table public.securities enable row level security;

drop policy if exists securities_select_own on public.securities;
drop policy if exists securities_insert_own on public.securities;
drop policy if exists securities_update_own on public.securities;
drop policy if exists securities_delete_own on public.securities;

create policy securities_select_own on public.securities for select to authenticated using (user_id = auth.uid());
create policy securities_insert_own on public.securities for insert to authenticated with check (user_id = auth.uid());
create policy securities_update_own on public.securities for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy securities_delete_own on public.securities for delete to authenticated using (user_id = auth.uid());

drop trigger if exists securities_set_updated_at on public.securities;
create trigger securities_set_updated_at
before update on public.securities
for each row
execute function public.set_updated_at_timestamp();

insert into public.securities (
  user_id,
  ticker,
  company_name,
  sector,
  industry,
  exchange_code,
  instrument_type,
  country_code,
  currency_code,
  website_url,
  is_active,
  notes
)
select distinct on (source.user_id, upper(btrim(source.ticker)))
  source.user_id,
  upper(btrim(source.ticker)) as ticker,
  upper(btrim(source.ticker)) as company_name,
  null as sector,
  null as industry,
  null as exchange_code,
  'stock' as instrument_type,
  null as country_code,
  source.currency_code,
  null as website_url,
  true as is_active,
  null as notes
from (
  select user_id, ticker, currency_code, created_at from public.stock_buys
  union all
  select user_id, ticker, currency_code, created_at from public.stock_sells
  union all
  select user_id, ticker, currency_code, created_at from public.dividend_entries
) as source
where btrim(coalesce(source.ticker, '')) <> ''
order by source.user_id, upper(btrim(source.ticker)), source.created_at desc
on conflict do nothing;

alter table public.stock_buys add column if not exists security_id uuid references public.securities(id);
alter table public.stock_sells add column if not exists security_id uuid references public.securities(id);
alter table public.dividend_entries add column if not exists security_id uuid references public.securities(id);

update public.stock_buys
set security_id = securities.id
from public.securities
where stock_buys.security_id is null
  and securities.user_id = stock_buys.user_id
  and upper(btrim(securities.ticker)) = upper(btrim(stock_buys.ticker));

update public.stock_sells
set security_id = securities.id
from public.securities
where stock_sells.security_id is null
  and securities.user_id = stock_sells.user_id
  and upper(btrim(securities.ticker)) = upper(btrim(stock_sells.ticker));

update public.dividend_entries
set security_id = securities.id
from public.securities
where dividend_entries.security_id is null
  and securities.user_id = dividend_entries.user_id
  and upper(btrim(securities.ticker)) = upper(btrim(dividend_entries.ticker));

alter table public.stock_buys alter column security_id set not null;
alter table public.stock_sells alter column security_id set not null;
alter table public.dividend_entries alter column security_id set not null;

create index if not exists stock_buys_security_idx on public.stock_buys(security_id);
create index if not exists stock_sells_security_idx on public.stock_sells(security_id);
create index if not exists dividend_entries_security_idx on public.dividend_entries(security_id);

drop policy if exists stock_buys_insert_own on public.stock_buys;
drop policy if exists stock_buys_update_own on public.stock_buys;
drop policy if exists stock_sells_insert_own on public.stock_sells;
drop policy if exists stock_sells_update_own on public.stock_sells;
drop policy if exists dividend_entries_insert_own on public.dividend_entries;
drop policy if exists dividend_entries_update_own on public.dividend_entries;

create policy stock_buys_insert_own on public.stock_buys for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_buys.security_id and securities.user_id = auth.uid()
  )
);

create policy stock_buys_update_own on public.stock_buys for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_buys.security_id and securities.user_id = auth.uid()
  )
);

create policy stock_sells_insert_own on public.stock_sells for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_sells.security_id and securities.user_id = auth.uid()
  )
);

create policy stock_sells_update_own on public.stock_sells for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = stock_sells.security_id and securities.user_id = auth.uid()
  )
);

create policy dividend_entries_insert_own on public.dividend_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = dividend_entries.security_id and securities.user_id = auth.uid()
  )
);

create policy dividend_entries_update_own on public.dividend_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
  and exists (
    select 1 from public.securities where securities.id = dividend_entries.security_id and securities.user_id = auth.uid()
  )
);

drop index if exists public.stock_buys_ticker_idx;
drop index if exists public.stock_sells_ticker_idx;
drop index if exists public.dividend_entries_ticker_idx;

alter table public.stock_buys drop constraint if exists stock_buys_ticker_not_blank;
alter table public.stock_sells drop constraint if exists stock_sells_ticker_not_blank;
alter table public.dividend_entries drop constraint if exists dividend_entries_ticker_not_blank;

alter table public.stock_buys drop column if exists ticker;
alter table public.stock_sells drop column if exists ticker;
alter table public.dividend_entries drop column if exists ticker;