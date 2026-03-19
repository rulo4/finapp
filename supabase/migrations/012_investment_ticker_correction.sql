alter table public.stock_buys add column if not exists ticker text;
alter table public.stock_sells add column if not exists ticker text;
alter table public.dividend_entries add column if not exists ticker text;

update public.stock_buys
set ticker = upper(trim(investment_entities.name))
from public.investment_entities
where stock_buys.investment_entity_id = investment_entities.id
  and (stock_buys.ticker is null or btrim(stock_buys.ticker) = '');

update public.stock_sells
set ticker = upper(trim(investment_entities.name))
from public.investment_entities
where stock_sells.investment_entity_id = investment_entities.id
  and (stock_sells.ticker is null or btrim(stock_sells.ticker) = '');

update public.dividend_entries
set ticker = upper(trim(investment_entities.name))
from public.investment_entities
where dividend_entries.investment_entity_id = investment_entities.id
  and (dividend_entries.ticker is null or btrim(dividend_entries.ticker) = '');

alter table public.stock_buys alter column ticker set not null;
alter table public.stock_sells alter column ticker set not null;
alter table public.dividend_entries alter column ticker set not null;

alter table public.stock_buys add constraint stock_buys_ticker_not_blank check (btrim(ticker) <> '');
alter table public.stock_sells add constraint stock_sells_ticker_not_blank check (btrim(ticker) <> '');
alter table public.dividend_entries add constraint dividend_entries_ticker_not_blank check (btrim(ticker) <> '');

create index if not exists stock_buys_ticker_idx on public.stock_buys(ticker);
create index if not exists stock_sells_ticker_idx on public.stock_sells(ticker);
create index if not exists dividend_entries_ticker_idx on public.dividend_entries(ticker);

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
);
create policy stock_buys_update_own on public.stock_buys for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_buys.broker_id and brokers.user_id = auth.uid()
  )
);

create policy stock_sells_insert_own on public.stock_sells for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
);
create policy stock_sells_update_own on public.stock_sells for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = stock_sells.broker_id and brokers.user_id = auth.uid()
  )
);

create policy dividend_entries_insert_own on public.dividend_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
);
create policy dividend_entries_update_own on public.dividend_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.brokers where brokers.id = dividend_entries.broker_id and brokers.user_id = auth.uid()
  )
);

drop index if exists public.stock_buys_entity_idx;
drop index if exists public.stock_sells_entity_idx;
drop index if exists public.dividend_entries_entity_idx;

alter table public.stock_buys drop column if exists investment_entity_id;
alter table public.stock_sells drop column if exists investment_entity_id;
alter table public.dividend_entries drop column if exists investment_entity_id;
