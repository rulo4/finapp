alter table public.expense_entries alter column category_id drop not null;
alter table public.expense_entries alter column unit_of_measure drop not null;

drop policy if exists expense_entries_insert_own on public.expense_entries;
drop policy if exists expense_entries_update_own on public.expense_entries;

create policy expense_entries_insert_own on public.expense_entries for insert to authenticated with check (
  user_id = auth.uid()
  and (
    category_id is null
    or exists (
      select 1
      from public.expense_categories
      where expense_categories.id = expense_entries.category_id
        and expense_categories.user_id = auth.uid()
    )
  )
  and (
    unit_of_measure_id is null
    or exists (
      select 1
      from public.unit_of_measures
      where unit_of_measures.id = expense_entries.unit_of_measure_id
        and unit_of_measures.user_id = auth.uid()
    )
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
  and (
    category_id is null
    or exists (
      select 1
      from public.expense_categories
      where expense_categories.id = expense_entries.category_id
        and expense_categories.user_id = auth.uid()
    )
  )
  and (
    unit_of_measure_id is null
    or exists (
      select 1
      from public.unit_of_measures
      where unit_of_measures.id = expense_entries.unit_of_measure_id
        and unit_of_measures.user_id = auth.uid()
    )
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