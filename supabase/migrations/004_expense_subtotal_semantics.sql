-- Make subtotal_original the primary captured amount for expenses.

alter table public.expense_entries add column if not exists subtotal_original numeric(18, 6);

update public.expense_entries
set subtotal_original = coalesce(
  subtotal_original,
  total_amount_original,
  case
    when quantity is not null and quantity <> 0 and unit_cost_original is not null
      then round(quantity * unit_cost_original, 6)
    else null
  end
)
where subtotal_original is null;

alter table public.expense_entries alter column subtotal_original set not null;

alter table public.expense_entries drop constraint if exists expense_entries_subtotal_original_positive;
alter table public.expense_entries
  add constraint expense_entries_subtotal_original_positive check (subtotal_original > 0);

create or replace function public.sync_expense_entry_amounts()
returns trigger
language plpgsql
as $$
begin
  if new.subtotal_original is null then
    new.subtotal_original := new.total_amount_original;
  end if;

  if new.subtotal_original is not null then
    new.total_amount_original := new.subtotal_original;
  end if;

  if new.quantity is not null and new.quantity <> 0 and new.subtotal_original is not null then
    new.unit_cost_original := round(new.subtotal_original / new.quantity, 6);
  end if;

  return new;
end;
$$;

drop trigger if exists expense_entries_sync_amounts on public.expense_entries;
create trigger expense_entries_sync_amounts
before insert or update on public.expense_entries
for each row
execute function public.sync_expense_entry_amounts();

comment on column public.expense_entries.subtotal_original is 'Primary original-currency subtotal captured from the receipt or expense summary.';
comment on column public.expense_entries.unit_cost_original is 'Derived average unit cost kept for compatibility and later analysis.';
comment on column public.expense_entries.total_amount_original is 'Legacy mirror of subtotal_original kept for compatibility.';