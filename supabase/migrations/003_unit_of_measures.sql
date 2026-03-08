-- Add a user-scoped catalog for units of measure and wire expenses to it.

create table if not exists public.unit_of_measures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  notes text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists unit_of_measures_user_id_idx on public.unit_of_measures(user_id);
create unique index if not exists unit_of_measures_user_id_name_idx on public.unit_of_measures(user_id, lower(name));

grant select, insert, update, delete on public.unit_of_measures to authenticated;

alter table public.unit_of_measures enable row level security;

drop policy if exists unit_of_measures_select_own on public.unit_of_measures;
drop policy if exists unit_of_measures_insert_own on public.unit_of_measures;
drop policy if exists unit_of_measures_update_own on public.unit_of_measures;
drop policy if exists unit_of_measures_delete_own on public.unit_of_measures;
create policy unit_of_measures_select_own on public.unit_of_measures for select to authenticated using (user_id = auth.uid());
create policy unit_of_measures_insert_own on public.unit_of_measures for insert to authenticated with check (user_id = auth.uid());
create policy unit_of_measures_update_own on public.unit_of_measures for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy unit_of_measures_delete_own on public.unit_of_measures for delete to authenticated using (user_id = auth.uid());

alter table public.expense_entries add column if not exists unit_of_measure_id uuid references public.unit_of_measures(id);
create index if not exists expense_entries_unit_of_measure_id_idx on public.expense_entries(unit_of_measure_id);

drop policy if exists expense_entries_insert_own on public.expense_entries;
drop policy if exists expense_entries_update_own on public.expense_entries;

create policy expense_entries_insert_own on public.expense_entries for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.expense_categories
    where expense_categories.id = expense_entries.category_id
      and expense_categories.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.unit_of_measures
    where unit_of_measures.id = expense_entries.unit_of_measure_id
      and unit_of_measures.user_id = auth.uid()
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
  and exists (
    select 1
    from public.unit_of_measures
    where unit_of_measures.id = expense_entries.unit_of_measure_id
      and unit_of_measures.user_id = auth.uid()
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

insert into public.unit_of_measures (user_id, name, description, is_active)
select auth_user.id, seed.name, seed.description, true
from auth.users as auth_user
cross join (
  values
    ('pieza', 'Unidad individual'),
    ('kg', 'Kilogramo'),
    ('g', 'Gramo'),
    ('litro', 'Litro'),
    ('ml', 'Mililitro'),
    ('servicio', 'Servicio contratado'),
    ('mes', 'Periodo mensual')
) as seed(name, description)
where not exists (
  select 1
  from public.unit_of_measures existing
  where existing.user_id = auth_user.id
    and lower(existing.name) = lower(seed.name)
);

update public.expense_entries
set unit_of_measure_id = unit_match.id
from public.unit_of_measures as unit_match
where public.expense_entries.user_id = unit_match.user_id
  and lower(public.expense_entries.unit_of_measure) = lower(unit_match.name)
  and public.expense_entries.unit_of_measure_id is null;