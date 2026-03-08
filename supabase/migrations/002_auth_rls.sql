-- Add user ownership and row-level security policies for authenticated sessions.

alter table public.expense_categories add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.income_sources add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.payment_instruments add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.stores add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.brokers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.investment_entities add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.income_entries add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.expense_entries add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.expense_categories alter column user_id set default auth.uid();
alter table public.income_sources alter column user_id set default auth.uid();
alter table public.payment_instruments alter column user_id set default auth.uid();
alter table public.stores alter column user_id set default auth.uid();
alter table public.brokers alter column user_id set default auth.uid();
alter table public.investment_entities alter column user_id set default auth.uid();
alter table public.income_entries alter column user_id set default auth.uid();
alter table public.expense_entries alter column user_id set default auth.uid();

alter table public.expense_categories drop constraint if exists expense_categories_name_key;
alter table public.income_sources drop constraint if exists income_sources_name_key;
alter table public.payment_instruments drop constraint if exists payment_instruments_name_key;
alter table public.stores drop constraint if exists stores_name_key;
alter table public.brokers drop constraint if exists brokers_name_key;
alter table public.investment_entities drop constraint if exists investment_entities_name_key;

create index if not exists expense_categories_user_id_idx on public.expense_categories(user_id);
create index if not exists income_sources_user_id_idx on public.income_sources(user_id);
create index if not exists payment_instruments_user_id_idx on public.payment_instruments(user_id);
create index if not exists stores_user_id_idx on public.stores(user_id);
create index if not exists brokers_user_id_idx on public.brokers(user_id);
create index if not exists investment_entities_user_id_idx on public.investment_entities(user_id);
create index if not exists income_entries_user_id_idx on public.income_entries(user_id);
create index if not exists expense_entries_user_id_idx on public.expense_entries(user_id);

create unique index if not exists expense_categories_user_id_name_idx on public.expense_categories(user_id, lower(name)) where user_id is not null;
create unique index if not exists income_sources_user_id_name_idx on public.income_sources(user_id, lower(name)) where user_id is not null;
create unique index if not exists payment_instruments_user_id_name_idx on public.payment_instruments(user_id, lower(name)) where user_id is not null;
create unique index if not exists stores_user_id_name_idx on public.stores(user_id, lower(name)) where user_id is not null;
create unique index if not exists brokers_user_id_name_idx on public.brokers(user_id, lower(name)) where user_id is not null;
create unique index if not exists investment_entities_user_id_name_idx on public.investment_entities(user_id, lower(name)) where user_id is not null;

grant select, insert, update, delete on public.expense_categories to authenticated;
grant select, insert, update, delete on public.income_sources to authenticated;
grant select, insert, update, delete on public.payment_instruments to authenticated;
grant select, insert, update, delete on public.stores to authenticated;
grant select, insert, update, delete on public.brokers to authenticated;
grant select, insert, update, delete on public.investment_entities to authenticated;
grant select, insert, update, delete on public.income_entries to authenticated;
grant select, insert, update, delete on public.expense_entries to authenticated;

alter table public.expense_categories enable row level security;
alter table public.income_sources enable row level security;
alter table public.payment_instruments enable row level security;
alter table public.stores enable row level security;
alter table public.brokers enable row level security;
alter table public.investment_entities enable row level security;
alter table public.income_entries enable row level security;
alter table public.expense_entries enable row level security;

drop policy if exists expense_categories_select_own on public.expense_categories;
drop policy if exists expense_categories_insert_own on public.expense_categories;
drop policy if exists expense_categories_update_own on public.expense_categories;
drop policy if exists expense_categories_delete_own on public.expense_categories;
create policy expense_categories_select_own on public.expense_categories for select to authenticated using (user_id = auth.uid());
create policy expense_categories_insert_own on public.expense_categories for insert to authenticated with check (user_id = auth.uid());
create policy expense_categories_update_own on public.expense_categories for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy expense_categories_delete_own on public.expense_categories for delete to authenticated using (user_id = auth.uid());

drop policy if exists income_sources_select_own on public.income_sources;
drop policy if exists income_sources_insert_own on public.income_sources;
drop policy if exists income_sources_update_own on public.income_sources;
drop policy if exists income_sources_delete_own on public.income_sources;
create policy income_sources_select_own on public.income_sources for select to authenticated using (user_id = auth.uid());
create policy income_sources_insert_own on public.income_sources for insert to authenticated with check (user_id = auth.uid());
create policy income_sources_update_own on public.income_sources for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy income_sources_delete_own on public.income_sources for delete to authenticated using (user_id = auth.uid());

drop policy if exists payment_instruments_select_own on public.payment_instruments;
drop policy if exists payment_instruments_insert_own on public.payment_instruments;
drop policy if exists payment_instruments_update_own on public.payment_instruments;
drop policy if exists payment_instruments_delete_own on public.payment_instruments;
create policy payment_instruments_select_own on public.payment_instruments for select to authenticated using (user_id = auth.uid());
create policy payment_instruments_insert_own on public.payment_instruments for insert to authenticated with check (user_id = auth.uid());
create policy payment_instruments_update_own on public.payment_instruments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy payment_instruments_delete_own on public.payment_instruments for delete to authenticated using (user_id = auth.uid());

drop policy if exists stores_select_own on public.stores;
drop policy if exists stores_insert_own on public.stores;
drop policy if exists stores_update_own on public.stores;
drop policy if exists stores_delete_own on public.stores;
create policy stores_select_own on public.stores for select to authenticated using (user_id = auth.uid());
create policy stores_insert_own on public.stores for insert to authenticated with check (user_id = auth.uid());
create policy stores_update_own on public.stores for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy stores_delete_own on public.stores for delete to authenticated using (user_id = auth.uid());

drop policy if exists brokers_select_own on public.brokers;
drop policy if exists brokers_insert_own on public.brokers;
drop policy if exists brokers_update_own on public.brokers;
drop policy if exists brokers_delete_own on public.brokers;
create policy brokers_select_own on public.brokers for select to authenticated using (user_id = auth.uid());
create policy brokers_insert_own on public.brokers for insert to authenticated with check (user_id = auth.uid());
create policy brokers_update_own on public.brokers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy brokers_delete_own on public.brokers for delete to authenticated using (user_id = auth.uid());

drop policy if exists investment_entities_select_own on public.investment_entities;
drop policy if exists investment_entities_insert_own on public.investment_entities;
drop policy if exists investment_entities_update_own on public.investment_entities;
drop policy if exists investment_entities_delete_own on public.investment_entities;
create policy investment_entities_select_own on public.investment_entities for select to authenticated using (user_id = auth.uid());
create policy investment_entities_insert_own on public.investment_entities for insert to authenticated with check (user_id = auth.uid());
create policy investment_entities_update_own on public.investment_entities for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy investment_entities_delete_own on public.investment_entities for delete to authenticated using (user_id = auth.uid());

drop policy if exists income_entries_select_own on public.income_entries;
drop policy if exists income_entries_insert_own on public.income_entries;
drop policy if exists income_entries_update_own on public.income_entries;
drop policy if exists income_entries_delete_own on public.income_entries;
create policy income_entries_select_own on public.income_entries for select to authenticated using (user_id = auth.uid());
create policy income_entries_insert_own on public.income_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.income_sources
    where income_sources.id = income_entries.source_id
      and income_sources.user_id = auth.uid()
  )
);
create policy income_entries_update_own on public.income_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.income_sources
    where income_sources.id = income_entries.source_id
      and income_sources.user_id = auth.uid()
  )
);
create policy income_entries_delete_own on public.income_entries for delete to authenticated using (user_id = auth.uid());

drop policy if exists expense_entries_select_own on public.expense_entries;
drop policy if exists expense_entries_insert_own on public.expense_entries;
drop policy if exists expense_entries_update_own on public.expense_entries;
drop policy if exists expense_entries_delete_own on public.expense_entries;
create policy expense_entries_select_own on public.expense_entries for select to authenticated using (user_id = auth.uid());
create policy expense_entries_insert_own on public.expense_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.expense_categories
    where expense_categories.id = expense_entries.category_id
      and expense_categories.user_id = auth.uid()
  )
  and (
    payment_instrument_id is null
    or exists (
      select 1
      from public.payment_instruments
      where payment_instruments.id = expense_entries.payment_instrument_id
        and payment_instruments.user_id = auth.uid()
    )
  )
  and (
    store_id is null
    or exists (
      select 1
      from public.stores
      where stores.id = expense_entries.store_id
        and stores.user_id = auth.uid()
    )
  )
);
create policy expense_entries_update_own on public.expense_entries for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.expense_categories
    where expense_categories.id = expense_entries.category_id
      and expense_categories.user_id = auth.uid()
  )
  and (
    payment_instrument_id is null
    or exists (
      select 1
      from public.payment_instruments
      where payment_instruments.id = expense_entries.payment_instrument_id
        and payment_instruments.user_id = auth.uid()
    )
  )
  and (
    store_id is null
    or exists (
      select 1
      from public.stores
      where stores.id = expense_entries.store_id
        and stores.user_id = auth.uid()
    )
  )
);
create policy expense_entries_delete_own on public.expense_entries for delete to authenticated using (user_id = auth.uid());